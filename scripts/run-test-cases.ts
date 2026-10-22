
type TestStatus = "PASS" | "FAIL" | "PENDING";

type TestCaseResult = {
  id: string;
  name: string;
  input: string;
  expected: string;
  actual: string;
  status: TestStatus;
  evidence: string[];
};

type Issue = {
  source_url?: string;
  sourceUrl?: string;
  url?: string;
  target_url?: string;
  targetUrl?: string;
  status_code?: number;
  statusCode?: number;
  redirect_chain?: string[];
  redirectChain?: string[];
  fixed?: boolean;
  status?: string;
};

type CrawlResult = {
  issues?: Issue[];
  crawled_pages?: number;
  crawledPages?: number;
  page_limit?: number;
  pageLimit?: number;
  remaining_pages?: string[];
  remainingPages?: string[];
};

function check(
  condition: boolean,
  actual: string,
  evidence: string[]
): { status: TestStatus; actual: string; evidence: string[] } {
  return {
    status: condition ? "PASS" : "FAIL",
    actual,
    evidence,
  };
}

function runTestCases(result: CrawlResult): TestCaseResult[] {
  const issues = result.issues ?? [];

  const tc1Issue = issues.find((issue) =>
    (issue.source_url ?? issue.sourceUrl ?? "").includes("/about") &&
    (issue.status_code ?? issue.statusCode) === 404
  );

  const tc2Issue = issues.find((issue) => {
    const chain = issue.redirect_chain ?? issue.redirectChain ?? [];
    return chain.length >= 3;
  });

  const crawled = result.crawled_pages ?? result.crawledPages ?? 0;
  const limit = result.page_limit ?? result.pageLimit ?? 200;
  const remaining =
    result.remaining_pages ?? result.remainingPages ?? [];

  const tc3Pass =
    crawled <= limit &&
    (crawled >= limit || remaining.length > 0);

  const tc4Issue = issues.find(
    (issue) =>
      issue.fixed === true ||
      ["fixed", "closed", "resolved"].includes(
        (issue.status ?? "").toLowerCase()
      )
  );

  return [
    {
      id: "TC1",
      name: "Internal broken link",
      input: "Crawl a site containing a broken /about link",
      expected: "Detect the broken link and report HTTP 404",
      ...check(
        Boolean(tc1Issue),
        tc1Issue
          ? "Broken link from /about returned HTTP 404"
          : "No matching /about HTTP 404 issue found",
        tc1Issue
          ? [
              `Source: ${tc1Issue.source_url ?? tc1Issue.sourceUrl}`,
              `Target: ${tc1Issue.target_url ?? tc1Issue.targetUrl ?? tc1Issue.url ?? "Not supplied"}`,
              "HTTP status: 404",
            ]
          : ["No matching issue in the supplied crawl result"]
      ),
    },
    {
      id: "TC2",
      name: "Redirect chain",
      input: "Crawl a site containing /old → /a → /b → /final",
      expected: "Detect and report the redirect chain",
      ...check(
        Boolean(tc2Issue),
        tc2Issue
          ? `Detected ${(
              tc2Issue.redirect_chain ??
              tc2Issue.redirectChain ??
              []
            ).length} redirect hops`
          : "No redirect chain with at least three entries found",
        tc2Issue
          ? [
              ...(
                tc2Issue.redirect_chain ??
                tc2Issue.redirectChain ??
                []
              ),
            ]
          : ["No redirect-chain evidence in the supplied crawl result"]
      ),
    },
    {
      id: "TC3",
      name: "Crawl page limit",
      input: "Crawl a demo site containing more than 250 pages",
      expected: `Do not exceed the configured limit of ${limit} pages`,
      ...check(
        tc3Pass,
        `Crawled ${crawled} pages; configured limit is ${limit}`,
        [
          `Crawled pages: ${crawled}`,
          `Page limit: ${limit}`,
          `Remaining pages reported: ${remaining.length}`,
        ]
      ),
    },
    {
      id: "TC4",
      name: "Broken-link fix and recheck",
      input: "Fix the demo broken link and recheck it",
      expected: "Mark the issue as fixed, closed, or resolved",
      ...check(
        Boolean(tc4Issue),
        tc4Issue
          ? `Issue status: ${tc4Issue.status ?? "fixed"}`
          : "No fixed or resolved issue found",
        tc4Issue
          ? [
              `Target: ${tc4Issue.target_url ?? tc4Issue.targetUrl ?? tc4Issue.url ?? "Not supplied"}`,
              `Status: ${tc4Issue.status ?? "fixed"}`,
            ]
          : ["No fix-confirmation evidence in the supplied crawl result"]
      ),
    },
  ];
}

// Call this function with the actual crawl result from your backend.
export function printTestResults(result: CrawlResult): TestCaseResult[] {
  const results = runTestCases(result);

  console.table(
    results.map(({ id, name, status, actual }) => ({
      id,
      name,
      status,
      actual,
    }))
  );

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        results,
      },
      null,
      2
    )
  );

  return results;
}
