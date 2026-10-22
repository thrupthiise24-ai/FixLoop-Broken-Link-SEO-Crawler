/**
 * Shared contracts between the crawler (Member A), agent/data layer (Member B),
 * and the web app (Member C). Keep API JSON in snake_case at the HTTP boundary;
 * TypeScript contracts use camelCase internally.
 */

export type IssueType =
  | "broken_link"
  | "redirect_chain"
  | "missing_title"
  | "duplicate_title"
  | "missing_meta_description"
  | "missing_h1"
  | "missing_alt";

export type IssueStatus =
  | "pending_approval"
  | "open"
  | "fixed"
  | "still_failing"
  | "rejected"
  | "uncertain";

export type Severity = "high" | "medium" | "low";
export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface PlannedPage {
  url: string;
  depth: number;
  priority: number;
  priorityReason: string;
  status?: "planned" | "crawled" | "not_crawled";
}

export interface NotCrawledPage {
  url: string;
  reason: string;
}

export interface CrawlPlan {
  /** Candidate pages, ranked highest priority first. */
  pages: PlannedPage[];
  /** Pages the planner already knows cannot fit in the configured limit. */
  notCrawled: NotCrawledPage[];
}

export interface CrawlPage {
  url: string;
  depth: number;
  priority?: number;
  priorityReason?: string;
  statusCode?: number | null;
  title?: string | null;
  metaDescription?: string | null;
  h1Count?: number;
  imagesMissingAlt?: string[];
  crawledAt?: string;
  crawled?: boolean;
}

export type LinkOutcome = "ok" | "error" | "timeout" | "unknown";

export interface CrawledLink {
  sourceUrl: string;
  targetUrl: string;
  statusCode?: number | null;
  redirectChain?: string[];
  checkedAt?: string;
  outcome?: LinkOutcome;
  internal?: boolean;
  error?: string;
}

export interface CrawlSnapshot {
  pages: CrawlPage[];
  links: CrawledLink[];
  /** Links/pages discovered but not visited, with a human-readable reason. */
  notCrawled?: NotCrawledPage[];
}

/** Evidence supplied by one of the detector functions. */
export interface DetectorFinding {
  type: IssueType;
  sourceUrl: string;
  badUrl: string;
  statusCode?: number | null;
  redirectChain?: string[];
  severity?: Severity;
  checkedAt?: string;
  outcome?: LinkOutcome;
  /** True for a concrete detector match; false is reserved for re-checks. */
  evidence?: Record<string, unknown>;
  message?: string;
}

export interface RecheckResult {
  outcome?: LinkOutcome;
  statusCode?: number | null;
  redirectChain?: string[];
  title?: string | null;
  metaDescription?: string | null;
  h1Count?: number;
  missingAltCount?: number;
  /** Use this when the crawler/detector can directly decide whether the issue remains. */
  stillPresent?: boolean;
  checkedAt?: string;
  error?: string;
  evidence?: Record<string, unknown>;
}

export interface IssueDraft {
  title: string;
  description: string;
  suggestedFix: string;
}

/**
 * Adapter boundary for Member A's planner, crawler, and detectors.
 * Member B's orchestrator owns ordering/persistence and enforces the limit;
 * Member A owns how the pages and observations are fetched.
 */
export interface AuditEngine {
  plan(siteUrl: string, pageLimit: number): Promise<CrawlPlan>;
  crawl(plan: CrawlPlan, pageLimit: number): Promise<CrawlSnapshot>;
  detect(snapshot: CrawlSnapshot): Promise<DetectorFinding[]> | DetectorFinding[];
  /** Re-fetch the affected source page/link and return fresh evidence. */
  recheck?(finding: DetectorFinding): Promise<RecheckResult>;
}

export interface Run {
  id: string;
  siteUrl: string;
  pageLimit: number;
  permissionConfirmed: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  crawledCount: number;
  totalPages: number;
  plan: PlannedPage[];
  notCrawled: NotCrawledPage[];
  error: string | null;
}

export interface Evidence {
  id: string;
  issueId: string;
  runId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

export interface Issue {
  id: string;
  dedupeKey: string;
  rootCauseKey: string;
  type: IssueType;
  severity: Severity;
  status: IssueStatus;
  sourceUrl: string;
  badUrl: string;
  statusCode: number | null;
  redirectChain: string[];
  title: string;
  description: string;
  suggestedFix: string;
  trackerId: string | null;
  trackerUrl: string | null;
  trackerState: "not_filed" | "open" | "closed" | "close_failed";
  approvedAt: string | null;
  closedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidence?: Evidence[];
}

export interface IssueRootCauseGroup {
  rootCauseKey: string;
  type: IssueType;
  badUrl: string;
  severity: Severity;
  status: IssueStatus;
  issueIds: string[];
  sourcePages: string[];
  sourceCount: number;
}

export interface TestCaseRecord {
  id: number;
  testCase: "TC1" | "TC2" | "TC3" | "TC4";
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  evidence: string[];
  notes: string | null;
  createdAt: string;
}
