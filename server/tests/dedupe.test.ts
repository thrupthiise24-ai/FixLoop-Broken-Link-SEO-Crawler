import assert from "node:assert/strict";
import test from "node:test";
import type { DetectorFinding } from "../../shared/types";
import { openDatabase } from "../src/db/client";
import { EvidenceRepository } from "../src/db/repositories/evidence";
import { IssueRepository, makeDedupeKey } from "../src/db/repositories/issues";
import { PageRepository } from "../src/db/repositories/pages";
import { RunRepository } from "../src/db/repositories/runs";

function finding(sourceUrl: string): DetectorFinding {
  return {
    type: "broken_link",
    sourceUrl,
    badUrl: "https://example.test/missing",
    statusCode: 404,
    outcome: "error",
    checkedAt: "2026-10-21T12:00:00.000Z",
  };
}

function proposed(runId: string, item: DetectorFinding) {
  return {
    runId,
    type: item.type,
    severity: "high" as const,
    status: "pending_approval" as const,
    sourceUrl: item.sourceUrl,
    badUrl: item.badUrl,
    statusCode: item.statusCode,
    redirectChain: [],
    title: "Broken link",
    description: "A page links to a URL that returns 404.",
    suggestedFix: "Update or remove the link.",
    checkedAt: item.checkedAt,
  };
}

test("issue retries are idempotent and evidence is stored once per observation", () => {
  const db = openDatabase(":memory:");
  try {
    const runs = new RunRepository(db);
    const pages = new PageRepository(db);
    const issues = new IssueRepository(db);
    const evidence = new EvidenceRepository(db);
    const run = runs.create({ siteUrl: "https://example.test/", pageLimit: 20, permissionConfirmed: true });
    const sourceUrl = "https://example.test/about";
    pages.savePlan(run.id, [{ url: sourceUrl, depth: 1, priority: 8, priorityReason: "Navigation page" }]);

    const input = finding(sourceUrl);
    const first = issues.propose(proposed(run.id, input));
    const retry = issues.propose(proposed(run.id, input));

    assert.equal(first.id, retry.id);
    assert.equal(first.dedupeKey, makeDedupeKey(sourceUrl, input.badUrl, "broken_link"));
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM issues").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM issue_runs").get() as { count: number }).count, 1);

    const evidenceInput = {
      issueId: first.id,
      runId: run.id,
      kind: "detector",
      capturedAt: input.checkedAt,
      payload: { sourcePage: sourceUrl, statusCode: 404 },
    };
    const firstEvidence = evidence.record(evidenceInput);
    const retryEvidence = evidence.record(evidenceInput);
    assert.equal(firstEvidence.id, retryEvidence.id);
    assert.equal(evidence.listForIssue(first.id).length, 1);
  } finally {
    db.close();
  }
});

test("root-cause grouping lists every source for the same bad URL", () => {
  const db = openDatabase(":memory:");
  try {
    const runs = new RunRepository(db);
    const pages = new PageRepository(db);
    const issues = new IssueRepository(db);
    const run = runs.create({ siteUrl: "https://example.test/", pageLimit: 50, permissionConfirmed: true });
    const sources = ["https://example.test/about", "https://example.test/contact"];
    pages.savePlan(run.id, sources.map((url, index) => ({
      url,
      depth: 1,
      priority: 10 - index,
      priorityReason: "Internal navigation",
    })));
    for (const source of sources) issues.propose(proposed(run.id, finding(source)));

    const groups = issues.listRootCauseGroups(run.id);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].sourceCount, 2);
    assert.deepEqual(groups[0].sourcePages, sources);
    assert.equal(issues.listByRun(run.id).length, 2);
  } finally {
    db.close();
  }
});
