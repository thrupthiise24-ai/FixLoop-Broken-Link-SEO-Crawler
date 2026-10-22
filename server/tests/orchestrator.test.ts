import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEngine, CrawlPlan, CrawlSnapshot, DetectorFinding } from "../../shared/types";
import { AuditOrchestrator } from "../src/agent/orchestrator";
import { IssueDrafter } from "../src/agent/issueDrafter";
import { openDatabase } from "../src/db/client";
import { EvidenceRepository } from "../src/db/repositories/evidence";
import { IssueRepository } from "../src/db/repositories/issues";
import { LinkRepository } from "../src/db/repositories/links";
import { PageRepository } from "../src/db/repositories/pages";
import { RunRepository } from "../src/db/repositories/runs";

const origin = "https://example.test";
const finding: DetectorFinding = {
  type: "broken_link",
  sourceUrl: `${origin}/about`,
  badUrl: `${origin}/missing-page`,
  statusCode: 404,
  outcome: "error",
  checkedAt: "2026-10-21T12:00:00.000Z",
  evidence: { response: "Not Found" },
};

const engine: AuditEngine = {
  async plan(): Promise<CrawlPlan> {
    return {
      pages: [
        { url: `${origin}/`, depth: 0, priority: 100, priorityReason: "Home page" },
        { url: `${origin}/about`, depth: 1, priority: 80, priorityReason: "Navigation page" },
        { url: `${origin}/contact`, depth: 1, priority: 70, priorityReason: "High inbound links" },
      ],
      notCrawled: [],
    };
  },
  async crawl(): Promise<CrawlSnapshot> {
    return {
      pages: [
        { url: `${origin}/`, depth: 0, statusCode: 200, title: "Home" },
        { url: `${origin}/about`, depth: 1, statusCode: 200, title: "About" },
        // Simulate a buggy crawler returning one extra result. The orchestrator
        // must never persist this as crawled beyond the configured limit.
        { url: `${origin}/contact`, depth: 1, statusCode: 200, title: "Contact" },
      ],
      links: [
        { sourceUrl: `${origin}/about`, targetUrl: `${origin}/missing-page`, statusCode: 404, outcome: "error" },
      ],
    };
  },
  detect(): DetectorFinding[] {
    return [finding];
  },
};

test("orchestrator plans, persists evidence, detects issues, and enforces the page cap", async () => {
  const db = openDatabase(":memory:");
  try {
    const runs = new RunRepository(db);
    const pages = new PageRepository(db);
    const links = new LinkRepository(db, pages);
    const issues = new IssueRepository(db);
    const evidence = new EvidenceRepository(db);
    const run = runs.create({ siteUrl: `${origin}/`, pageLimit: 2, permissionConfirmed: true });
    const orchestrator = new AuditOrchestrator({
      runs,
      pages,
      links,
      issues,
      evidence,
      engine,
      drafter: new IssueDrafter(),
      maxPageLimit: 200,
    });

    const result = await orchestrator.executeRun(run.id);
    const savedRun = runs.get(run.id)!;

    assert.equal(savedRun.status, "completed");
    assert.equal(savedRun.crawledCount, 2);
    assert.equal(result.notCrawledCount, 1);
    assert.equal(savedRun.plan.length, 2);
    assert.equal(savedRun.notCrawled[0].url, `${origin}/contact`);
    assert.equal(pages.listByRun(run.id).filter((page) => page.crawled).length, 2);
    assert.equal(links.listByRun(run.id).length, 1);
    assert.equal(result.proposedIssueCount, 1);

    const savedIssue = issues.listByRun(run.id)[0];
    assert.equal(savedIssue.status, "pending_approval");
    assert.equal(savedIssue.statusCode, 404);
    assert.equal(evidence.listForIssue(savedIssue.id)[0].payload.sourcePage, `${origin}/about`);
    // The agent proposes only. Filing is a separate human-approved action.
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 0);
  } finally {
    db.close();
  }
});
