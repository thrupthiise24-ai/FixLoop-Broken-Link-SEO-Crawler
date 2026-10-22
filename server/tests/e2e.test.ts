import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { openDatabase } from "../src/db/client";
import { createServer } from "../src/index";

const DEMO_PAGE_COUNT_FOR_TEST = 260;

type ApiIssue = {
  id: string;
  type?: string;
  source_page?: string;
  bad_url?: string;
  status_code?: number | null;
  redirect_chain?: string[];
  status?: string;
};

test("end-to-end TC1-TC4 against the real demo site and HTTP crawler", { timeout: 60_000 }, async () => {
  const db = openDatabase(":memory:");
  const service = createServer({
    db,
    config: {
      port: 0,
      databasePath: ":memory:",
      maxPageLimit: 200,
      anthropicModel: "test-model",
      nodeEnv: "test",
    },
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const api = `http://127.0.0.1:${address.port}`;
  const demoUrl = `${api}/demo/`;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${api}${path}`, init);
  }

  async function waitForRun(runId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const response = await request(`/api/runs/${runId}`);
      const payload = await response.json() as { run: Record<string, unknown> };
      if (["completed", "failed"].includes(String(payload.run.status))) return payload.run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for the real crawl to finish.");
  }

  const testResults: Array<{
    id: "TC1" | "TC2" | "TC3" | "TC4";
    input: string;
    expected: string;
    actual: string;
    status: "PASS" | "FAIL";
    evidence: string[];
    notes?: string;
  }> = [];

  try {
    const reset = await request("/api/demo/reset", { method: "POST" });
    assert.equal(reset.status, 200);

    const crawlResponse = await request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_url: demoUrl, page_limit: 200, permission_confirmed: true }),
    });
    assert.equal(crawlResponse.status, 202);
    const created = await crawlResponse.json() as { run_id: string };
    const run = await waitForRun(created.run_id);
    assert.equal(run.status, "completed", String(run.error ?? "The crawl failed."));

    const issueResponse = await request(`/api/runs/${created.run_id}/issues`);
    assert.equal(issueResponse.status, 200);
    const issuePayload = await issueResponse.json() as { issues: ApiIssue[] };
    const issues = issuePayload.issues;

    const tc1Issue = issues.find((issue) =>
      issue.type === "broken_link" &&
      (issue.source_page ?? "").endsWith("/about") &&
      (issue.bad_url ?? "").endsWith("/missing-page") &&
      issue.status_code === 404,
    );
    testResults.push({
      id: "TC1",
      input: `Crawl ${demoUrl}; the /about page links to /missing-page.`,
      expected: "Create an issue naming /about as source and record HTTP 404 for /missing-page.",
      actual: tc1Issue
        ? `Found ${tc1Issue.type} from ${tc1Issue.source_page} to ${tc1Issue.bad_url}, HTTP ${tc1Issue.status_code}.`
        : "No matching /about → /missing-page 404 issue was returned.",
      status: tc1Issue ? "PASS" : "FAIL",
      evidence: tc1Issue ? [
        `Issue ID: ${tc1Issue.id}`,
        `Source: ${tc1Issue.source_page}`,
        `Target: ${tc1Issue.bad_url}`,
        `HTTP status: ${tc1Issue.status_code}`,
      ] : ["No matching issue in the run response."],
    });

    const tc2Issue = issues.find((issue) =>
      issue.type === "redirect_chain" && (issue.bad_url ?? "").endsWith("/old"),
    );
    const tc2Hops = tc2Issue?.redirect_chain ? Math.max(0, tc2Issue.redirect_chain.length - 1) : 0;
    testResults.push({
      id: "TC2",
      input: `${demoUrl}old → /a → /b → /final`,
      expected: "Flag the link because it follows at least three redirect hops.",
      actual: tc2Issue ? `Detected ${tc2Hops} redirect hops.` : "No redirect-chain issue for /old was returned.",
      status: tc2Issue && tc2Hops >= 3 ? "PASS" : "FAIL",
      evidence: tc2Issue?.redirect_chain ?? ["No redirect-chain evidence."],
    });

    const crawled = Number(run.crawled_count ?? 0);
    const pageLimit = Number(run.page_limit ?? 200);
    const remaining = Array.isArray(run.not_crawled) ? run.not_crawled as Array<{ url?: string; reason?: string }> : [];
    const tc3Pass = crawled === 200 && crawled <= pageLimit && remaining.length > 0;
    testResults.push({
      id: "TC3",
      input: `Crawl the generated site with ${DEMO_PAGE_COUNT_FOR_TEST} pages and a 200-page limit.`,
      expected: "Crawl no more than 200 pages and list pages left out by the limit.",
      actual: `Crawled ${crawled}/${pageLimit}; ${remaining.length} pages listed as not crawled.`,
      status: tc3Pass ? "PASS" : "FAIL",
      evidence: [
        `Crawled pages: ${crawled}`,
        `Page limit: ${pageLimit}`,
        `Not-crawled count: ${remaining.length}`,
        ...remaining.slice(0, 3).map((page) => `${page.url}: ${page.reason}`),
      ],
    });

    let tc4Status: "PASS" | "FAIL" = "FAIL";
    let tc4Actual = "Could not run recheck because TC1 was not found.";
    const tc4Evidence: string[] = [];
    if (tc1Issue) {
      const approvedResponse = await request(`/api/issues/${tc1Issue.id}/approve`, { method: "POST" });
      if (approvedResponse.ok) {
        const beforeStatus = tc1Issue.status_code;
        const fixResponse = await request("/api/demo/fix-broken-link", { method: "POST" });
        const fixBody = await fixResponse.json() as { changed?: boolean; status?: string };
        const recheckResponse = await request(`/api/issues/${tc1Issue.id}/recheck`, { method: "POST" });
        const recheckBody = await recheckResponse.json() as { issue?: ApiIssue; evidence?: Record<string, unknown> };
        const afterStatus = recheckBody.evidence?.statusCode;
        tc4Status = fixResponse.ok && recheckResponse.ok && recheckBody.issue?.status === "fixed" && afterStatus === 200
          ? "PASS"
          : "FAIL";
        tc4Actual = `Before: HTTP ${beforeStatus}; after demo fix/recheck: HTTP ${String(afterStatus)}, issue status ${recheckBody.issue?.status ?? "unknown"}.`;
        tc4Evidence.push(
          `Issue ID: ${tc1Issue.id}`,
          `Before fix: HTTP ${beforeStatus}`,
          `Fix toggle changed state: ${String(fixBody.changed)}`,
          `Recheck HTTP status: ${String(afterStatus)}`,
          `Final issue status: ${String(recheckBody.issue?.status)}`,
          `Tracker state: ${String(recheckBody.issue && "tracker_state" in recheckBody.issue ? (recheckBody.issue as Record<string, unknown>).tracker_state : "unknown")}`,
        );
      } else {
        tc4Actual = `Approval failed with HTTP ${approvedResponse.status}; no fix was attempted.`;
      }
    }
    testResults.push({
      id: "TC4",
      input: "Approve TC1, activate the demo fix toggle, and recheck the same issue.",
      expected: "Record before/after evidence and mark the issue fixed only after the target returns 200.",
      actual: tc4Actual,
      status: tc4Status,
      evidence: tc4Evidence.length ? tc4Evidence : ["TC1 issue was not available for recheck."],
    });

    const recorded = await request("/api/test-results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ results: testResults }),
    });
    assert.equal(recorded.status, 201);
    console.table(testResults.map(({ id, status, actual }) => ({ id, status, actual })));
    assert.ok(testResults.every((result) => result.status === "PASS"), JSON.stringify(testResults, null, 2));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});

