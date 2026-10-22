import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { AuditEngine, DetectorFinding } from "../../shared/types";
import { openDatabase } from "../src/db/client";
import { createServer } from "../src/index";

const siteUrl = "https://demo.test/";

function testEngine(state: { recheckCode: number }): AuditEngine {
  return {
    async plan() {
      return {
        pages: [
          { url: siteUrl, depth: 0, priority: 100, priorityReason: "Home page is the entry point." },
          { url: `${siteUrl}about`, depth: 1, priority: 80, priorityReason: "Linked from primary navigation." },
        ],
        notCrawled: [],
      };
    },
    async crawl(plan) {
      return {
        pages: plan.pages.map((page) => ({
          url: page.url,
          depth: page.depth,
          statusCode: 200,
          title: page.url === siteUrl ? "Demo home" : "About",
        })),
        links: [
          {
            sourceUrl: `${siteUrl}about`,
            targetUrl: `${siteUrl}missing-page`,
            statusCode: 404,
            outcome: "error",
            checkedAt: "2026-10-21T12:00:00.000Z",
          },
        ],
      };
    },
    detect() {
      const finding: DetectorFinding = {
        type: "broken_link",
        sourceUrl: `${siteUrl}about`,
        badUrl: `${siteUrl}missing-page`,
        statusCode: 404,
        outcome: "error",
        checkedAt: "2026-10-21T12:00:00.000Z",
      };
      return [finding];
    },
    async recheck() {
      return { outcome: "ok", statusCode: state.recheckCode };
    },
  };
}

async function waitForRun(base: string, runId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await fetch(`${base}/api/runs/${runId}`);
    const payload = await response.json() as { run: Record<string, unknown> };
    if (["completed", "failed"].includes(String(payload.run.status))) return payload.run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Run did not finish within the test timeout.");
}

test("API enforces permission, exposes plan/evidence, gates filing, and closes only after a passing recheck", async () => {
  const db = openDatabase(":memory:");
  const state = { recheckCode: 404 };
  const service = createServer({
    db,
    config: {
      port: 0,
      databasePath: ":memory:",
      maxPageLimit: 200,
      anthropicModel: "test-model",
      nodeEnv: "test",
    },
    engine: testEngine(state),
    demoFixBrokenLink: () => ({ changed: true, message: "Demo link fixed." }),
  });
  const httpServer = service.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const previewRoot = await fetch(`${base}/`, {
      redirect: "manual",
      headers: { "x-forwarded-host": "3002-test-preview.e2b.app" },
    });
    assert.equal(previewRoot.status, 302);
    assert.equal(previewRoot.headers.get("location"), "https://3001-test-preview.e2b.app/");

    const denied = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_url: siteUrl, page_limit: 2, permission_confirmed: false }),
    });
    assert.equal(denied.status, 403);

    const createdResponse = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_url: siteUrl, page_limit: 2, permission_confirmed: true }),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json() as { run_id: string };
    const run = await waitForRun(base, created.run_id);
    assert.equal(run.status, "completed");
    assert.equal(run.crawled_count, 2);
    assert.equal((run.plan as Array<{ priority_reason: string }>)[0].priority_reason, "Home page is the entry point.");

    const issueResponse = await fetch(`${base}/api/runs/${created.run_id}/issues`);
    const issuePayload = await issueResponse.json() as { issues: Array<Record<string, unknown>>; root_cause_groups: unknown[] };
    assert.equal(issuePayload.issues.length, 1);
    assert.equal(issuePayload.issues[0].status, "pending_approval");
    assert.equal((issuePayload.issues[0].evidence as unknown[]).length, 1);
    const issueId = String(issuePayload.issues[0].id);
    // Simulate a previous recheck: a confirmed, unfiled issue remains human-reviewable.
    db.prepare("UPDATE issues SET status = 'still_failing' WHERE id = ?").run(issueId);

    const approvedResponse = await fetch(`${base}/api/issues/${issueId}/approve`, { method: "POST" });
    const approved = await approvedResponse.json() as { issue: Record<string, unknown> };
    assert.equal(approvedResponse.status, 200);
    assert.equal(approved.issue.status, "open");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 1);

    const stillFailing = await fetch(`${base}/api/issues/${issueId}/recheck`, { method: "POST" });
    const stillFailingPayload = await stillFailing.json() as { issue: Record<string, unknown> };
    assert.equal(stillFailingPayload.issue.status, "still_failing");
    assert.equal((db.prepare("SELECT state FROM mock_tracker_issues").get() as { state: string }).state, "open");

    state.recheckCode = 200;
    const fixed = await fetch(`${base}/api/issues/${issueId}/recheck`, { method: "POST" });
    const fixedPayload = await fixed.json() as { issue: Record<string, unknown> };
    assert.equal(fixedPayload.issue.status, "fixed");
    assert.equal((db.prepare("SELECT state FROM mock_tracker_issues").get() as { state: string }).state, "closed");

    const demoToggle = await fetch(`${base}/api/demo/fix-broken-link`, { method: "POST" });
    assert.equal(demoToggle.status, 200);

    const recorded = await fetch(`${base}/api/test-results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        results: [{ id: "TC1", input: "demo", expected: "404 found", actual: "404", status: "PASS", evidence: ["/about -> /missing-page", "404"] }],
      }),
    });
    assert.equal(recorded.status, 201);
    const resultsResponse = await fetch(`${base}/api/test-results`);
    const results = await resultsResponse.json() as { results: Array<{ id: string; status: string }> };
    assert.equal(results.results[0].id, "TC1");
    assert.equal(results.results[0].status, "PASS");
  } finally {
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
