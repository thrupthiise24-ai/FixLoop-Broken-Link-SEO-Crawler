import type {
  Evidence,
  Issue,
  IssueRootCauseGroup,
  Run,
  TestCaseRecord,
} from "../../../shared/types";

export function serializeRun(run: Run) {
  return {
    id: run.id,
    site_url: run.siteUrl,
    page_limit: run.pageLimit,
    permission_confirmed: run.permissionConfirmed,
    status: run.status,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    crawled_count: run.crawledCount,
    total_pages: run.totalPages,
    plan: run.plan.map((page) => ({
      url: page.url,
      depth: page.depth,
      priority: page.priority,
      priority_reason: page.priorityReason,
      status: page.status ?? "planned",
    })),
    not_crawled: run.notCrawled.map((page) => ({ ...page })),
    error: run.error,
  };
}

function serializeEvidence(evidence: Evidence) {
  return {
    id: evidence.id,
    kind: evidence.kind,
    payload: evidence.payload,
    captured_at: evidence.capturedAt,
    run_id: evidence.runId,
  };
}

export function serializeIssue(issue: Issue) {
  return {
    id: issue.id,
    type: issue.type,
    severity: issue.severity,
    status: issue.status,
    source_page: issue.sourceUrl,
    source_url: issue.sourceUrl,
    bad_url: issue.badUrl,
    target_url: issue.badUrl,
    status_code: issue.statusCode,
    redirect_chain: issue.redirectChain,
    title: issue.title,
    description: issue.description,
    suggested_fix: issue.suggestedFix,
    dedupe_key: issue.dedupeKey,
    root_cause_key: issue.rootCauseKey,
    tracker_id: issue.trackerId,
    tracker_url: issue.trackerUrl,
    tracker_state: issue.trackerState,
    approved_at: issue.approvedAt,
    closed_at: issue.closedAt,
    last_checked_at: issue.lastCheckedAt,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    evidence: issue.evidence?.map(serializeEvidence) ?? [],
  };
}

export function serializeRootCauseGroup(group: IssueRootCauseGroup) {
  return {
    root_cause_key: group.rootCauseKey,
    type: group.type,
    bad_url: group.badUrl,
    severity: group.severity,
    status: group.status,
    issue_ids: group.issueIds,
    source_pages: group.sourcePages,
    source_count: group.sourceCount,
  };
}

const testNames: Record<TestCaseRecord["testCase"], string> = {
  TC1: "Detect internal broken link",
  TC2: "Detect redirect chain",
  TC3: "Respect crawl page limit",
  TC4: "Recheck a fixed broken link",
};

export function serializeTestResult(record: TestCaseRecord) {
  return {
    id: record.testCase,
    name: testNames[record.testCase],
    input: record.input,
    expected: record.expected,
    actual: record.actual,
    status: record.passed ? "PASS" : "FAIL",
    evidence: record.evidence.join("; "),
    notes: record.notes,
    generated_at: record.createdAt,
  };
}
