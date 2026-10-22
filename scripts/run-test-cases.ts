import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type TestStatus = "PASS" | "FAIL";
type OfficialId = "TC1" | "TC2" | "TC3" | "TC4";

type EvidenceIssue = {
  id: string;
  type?: string;
  source_page?: string;
  bad_url?: string;
  status_code?: number | null;
  redirect_chain?: string[];
  status?: string;
  tracker_state?: string;
};

type EvidenceResult = {
  id: OfficialId;
  name: string;
  input: string;
  expected: string;
  actual: string;
  status: TestStatus;
  evidence: string[];
  runId: string;
  generatedAt: string;
};

const API_BASE = (process.env.FIXLOOP_API_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const SITE_URL = process.env.FIXLOOP_SITE_URL ?? `${API_BASE}/demo/`;
const PAGE_LIMIT = 200;
const REPO_ROOT = existsSync(resolve(process.cwd(), "docs/evidence"))
  ? process.cwd()
  : resolve(process.cwd(), "..");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/evidence");

async function api(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} returned HTTP ${response.status}: ${body}`);
  }
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return await (await api(path, init)).json() as T;
}

async function waitForRun(runId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await json<{ run: Record<string, unknown> }>(`/api/runs/${encodeURIComponent(runId)}`);
    if (["completed", "failed"].includes(String(result.run.status))) return result.run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Run ${runId} did not finish within 60 seconds.`);
}

function makeResult(input: Omit<EvidenceResult, "generatedAt">): EvidenceResult {
  return { ...input, generatedAt: new Date().toISOString() };
}

function saveEvidence(results: EvidenceResult[]): void {
  for (const result of results) {
    const folder = resolve(EVIDENCE_DIR, result.id.toLowerCase());
    mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  }
  writeFileSync(
    resolve(EVIDENCE_DIR, "latest-run.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), apiBase: API_BASE, siteUrl: SITE_URL, pageLimit: PAGE_LIMIT, results }, null, 2)}\n`,
  );
}

export async function runOfficialTestCases(): Promise<EvidenceResult[]> {
  await json<{ status: string }>("/api/health");
  await api("/api/demo/reset", { method: "POST" });

  const created = await json<{ run_id: string }>("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      site_url: SITE_URL,
      page_limit: PAGE_LIMIT,
      permission_confirmed: true,
    }),
  });
  const runId = created.run_id;
  const run = await waitForRun(runId);
  if (run.status !== "completed") throw new Error(`Audit run failed: ${String(run.error ?? "unknown error")}`);

  const issuePayload = await json<{ issues: EvidenceIssue[] }>(`/api/runs/${encodeURIComponent(runId)}/issues`);
  const issues = issuePayload.issues;
  const tc1Issue = issues.find((issue) =>
    issue.type === "broken_link" &&
    (issue.source_page ?? "").endsWith("/about") &&
    (issue.bad_url ?? "").endsWith("/missing-page") &&
    issue.status_code === 404,
  );
  const tc1 = makeResult({
    id: "TC1",
    name: "Detect internal broken link",
    input: `Crawl ${SITE_URL}; /about links to /missing-page.`,
    expected: "Create an issue naming /about as the source and record HTTP 404 for /missing-page.",
    actual: tc1Issue
      ? `Found ${tc1Issue.type} from ${tc1Issue.source_page} to ${tc1Issue.bad_url}; HTTP ${tc1Issue.status_code}.`
      : "No matching source-page/target/404 issue was returned.",
    status: tc1Issue ? "PASS" : "FAIL",
    evidence: tc1Issue ? [
      `Issue ID: ${tc1Issue.id}`,
      `Source page: ${tc1Issue.source_page}`,
      `Bad URL: ${tc1Issue.bad_url}`,
      `Status code: ${tc1Issue.status_code}`,
    ] : ["No matching issue in the run response."],
    runId,
  });

  const tc2Issue = issues.find((issue) =>
    issue.type === "redirect_chain" && (issue.bad_url ?? "").endsWith("/old"),
  );
  const redirectChain = tc2Issue?.redirect_chain ?? [];
  const redirectHops = Math.max(0, redirectChain.length - 1);
  const tc2 = makeResult({
    id: "TC2",
    name: "Detect three-hop redirect chain",
    input: `${SITE_URL}old → /a → /b → /final.`,
    expected: "Flag the link and retain all redirect URLs for evidence.",
    actual: tc2Issue ? `Flagged a chain with ${redirectHops} redirect hop(s).` : "No redirect-chain issue for /old was returned.",
    status: tc2Issue && redirectHops >= 3 ? "PASS" : "FAIL",
    evidence: tc2Issue ? redirectChain : ["No redirect-chain evidence."],
    runId,
  });

  const crawledCount = Number(run.crawled_count ?? 0);
  const pageLimit = Number(run.page_limit ?? PAGE_LIMIT);
  const totalPages = Number(run.total_pages ?? 0);
  const notCrawled = Array.isArray(run.not_crawled)
    ? run.not_crawled as Array<{ url?: string; reason?: string }>
    : [];
  const tc3Pass = crawledCount === PAGE_LIMIT && crawledCount <= pageLimit && totalPages > 250 && notCrawled.length > 0;
  const tc3 = makeResult({
    id: "TC3",
    name: "Respect the 200-page crawl limit",
    input: `Crawl the generated 260+ page demo site with a ${PAGE_LIMIT}-page limit.`,
    expected: "Crawl no more than 200 pages and list the pages not visited because of the limit.",
    actual: `Crawled ${crawledCount}/${pageLimit}; ${totalPages} pages discovered; ${notCrawled.length} listed as not crawled.`,
    status: tc3Pass ? "PASS" : "FAIL",
    evidence: [
      `Crawled pages: ${crawledCount}`,
      `Configured limit: ${pageLimit}`,
      `Discovered pages: ${totalPages}`,
      `Not-crawled pages: ${notCrawled.length}`,
      ...notCrawled.slice(0, 5).map((page) => `${page.url}: ${page.reason}`),
    ],
    runId,
  });

  let tc4Status: TestStatus = "FAIL";
  let tc4Actual = "Cannot recheck because the TC1 issue was not found.";
  let tc4Evidence: string[] = ["No TC1 issue was available."];
  if (tc1Issue) {
    await api(`/api/issues/${encodeURIComponent(tc1Issue.id)}/approve`, { method: "POST" });
    const beforeStatus = tc1Issue.status_code;
    const fix = await json<{ changed: boolean; message?: string }>("/api/demo/fix-broken-link", { method: "POST" });
    const recheck = await json<{ issue: EvidenceIssue; evidence: Record<string, unknown> }>(
      `/api/issues/${encodeURIComponent(tc1Issue.id)}/recheck`,
      { method: "POST" },
    );
    const afterStatus = recheck.evidence.statusCode;
    tc4Status = recheck.issue.status === "fixed" && afterStatus === 200 ? "PASS" : "FAIL";
    tc4Actual = `Before fix: HTTP ${beforeStatus}; after fix: HTTP ${String(afterStatus)}; issue status: ${recheck.issue.status}.`;
    tc4Evidence = [
      `Issue ID: ${tc1Issue.id}`,
      `Before status: HTTP ${beforeStatus}`,
      `Fix toggle changed state: ${fix.changed}`,
      `After status: HTTP ${String(afterStatus)}`,
      `Final issue state: ${recheck.issue.status}`,
      `Tracker state: ${recheck.issue.tracker_state ?? "not reported"}`,
    ];
  }
  const tc4 = makeResult({
    id: "TC4",
    name: "Recheck and close only after a fix",
    input: "Approve the TC1 issue, turn on the demo fix, and recheck it.",
    expected: "Keep it open while broken; mark it fixed/closed only after the target returns HTTP 200.",
    actual: tc4Actual,
    status: tc4Status,
    evidence: tc4Evidence,
    runId,
  });

  const results = [tc1, tc2, tc3, tc4];
  saveEvidence(results);
  await api("/api/test-results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      results: results.map(({ id, input, expected, actual, status, evidence }) => ({
        id,
        input,
        expected,
        actual,
        status,
        evidence,
      })),
    }),
  });

  console.table(results.map(({ id, status, actual }) => ({ id, status, actual })));
  return results;
}

if (require.main === module) {
  runOfficialTestCases()
    .then((results) => {
      if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
    })
    .catch((error) => {
      console.error("Official test run failed:", error);
      process.exitCode = 1;
    });
}
