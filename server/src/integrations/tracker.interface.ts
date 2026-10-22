import type { IssueType, Severity } from "../../../shared/types";

export interface TrackerIssueDraft {
  dedupeKey: string;
  type: IssueType;
  severity: Severity;
  title: string;
  description: string;
  suggestedFix: string;
  sourceUrl: string;
  badUrl: string;
}

export interface TrackerRecord {
  id: string;
  url: string;
  state: "open" | "closed";
}

/** Both the mock and GitHub adapters must be idempotent by dedupe key. */
export interface IssueTracker {
  findByDedupeKey(dedupeKey: string): Promise<TrackerRecord | null>;
  createIssue(draft: TrackerIssueDraft): Promise<TrackerRecord>;
  closeIssue(issue: TrackerRecord): Promise<TrackerRecord>;
  reopenIssue(issue: TrackerRecord): Promise<TrackerRecord>;
}
