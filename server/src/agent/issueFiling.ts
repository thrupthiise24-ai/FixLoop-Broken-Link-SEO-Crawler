import type { IssueRepository } from "../db/repositories/issues";
import type { IssueTracker } from "../integrations/tracker.interface";
import type { Issue } from "../../../shared/types";
import { DomainError } from "./domainError";

export interface IssueFilingServiceDependencies {
  issues: IssueRepository;
  tracker: IssueTracker;
}

export class IssueFilingService {
  private readonly inFlight = new Map<string, Promise<Issue>>();

  constructor(private readonly deps: IssueFilingServiceDependencies) {}

  /** A keyed in-process lock prevents double clicks from racing through find+create. */
  approveAndFile(issueId: string, actor = "human"): Promise<Issue> {
    const existing = this.inFlight.get(issueId);
    if (existing) return existing;
    const operation = this.doApproveAndFile(issueId, actor).finally(() => {
      this.inFlight.delete(issueId);
    });
    this.inFlight.set(issueId, operation);
    return operation;
  }

  private async doApproveAndFile(issueId: string, actor: string): Promise<Issue> {
    let issue = this.deps.issues.get(issueId);
    if (!issue) throw new DomainError("Issue not found.", 404, "issue_not_found");

    if (issue.status === "open" && issue.trackerId && issue.trackerUrl) return issue;
    const canApprove = issue.status === "pending_approval" ||
      (issue.status === "still_failing" && !issue.trackerId && !issue.approvedAt);
    if (!canApprove) {
      throw new DomainError(
        `Issue cannot be filed from status ${issue.status}.`,
        409,
        "invalid_issue_state",
      );
    }

    try {
      issue = this.deps.issues.markApproved(issueId, actor);
      const existingRemote = await this.deps.tracker.findByDedupeKey(issue.dedupeKey);
      const trackerIssue = existingRemote
        ? existingRemote.state === "closed"
          ? await this.deps.tracker.reopenIssue(existingRemote)
          : existingRemote
        : await this.deps.tracker.createIssue({
            dedupeKey: issue.dedupeKey,
            type: issue.type,
            severity: issue.severity,
            title: issue.title,
            description: issue.description,
            suggestedFix: issue.suggestedFix,
            sourceUrl: issue.sourceUrl,
            badUrl: issue.badUrl,
          });
      return this.deps.issues.markFiled(issueId, trackerIssue);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // approved_at is retained; a retry can finish the idempotent filing step.
      throw new DomainError(
        error instanceof Error ? `Approved, but issue filing failed: ${error.message}` : "Approved, but issue filing failed.",
        502,
        "issue_filing_failed",
      );
    }
  }

  reject(issueId: string, actor = "human"): Issue {
    try {
      return this.deps.issues.markRejected(issueId, actor);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Issue not found")) {
        throw new DomainError("Issue not found.", 404, "issue_not_found");
      }
      throw new DomainError(
        error instanceof Error ? error.message : "Issue cannot be rejected.",
        409,
        "invalid_issue_state",
      );
    }
  }
}
