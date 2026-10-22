import type { Issue, RecheckResult } from "../../../shared/types";
import type { EvidenceRepository, IssueRepository } from "../db/repositories";
import type { IssueTracker } from "../integrations/tracker.interface";
import { DomainError } from "./domainError";

export interface RecheckProbe {
  recheck(issue: Issue): Promise<RecheckResult>;
}

export interface RecheckerDependencies {
  issues: IssueRepository;
  evidence: EvidenceRepository;
  probe: RecheckProbe;
  tracker: IssueTracker;
}

export interface RecheckOutcome {
  issue: Issue;
  trackerCloseWarning?: string;
  evidence: Record<string, unknown>;
}

function issueStillPresent(issue: Issue, result: RecheckResult): boolean | undefined {
  if (typeof result.stillPresent === "boolean") return result.stillPresent;

  switch (issue.type) {
    case "broken_link":
      if (result.statusCode == null) return undefined;
      return result.statusCode >= 400;
    case "redirect_chain":
      if (!Array.isArray(result.redirectChain)) return undefined;
      return result.redirectChain.length >= 3;
    case "missing_title":
      if (result.title === undefined) return undefined;
      return !result.title?.trim();
    case "missing_meta_description":
      if (result.metaDescription === undefined) return undefined;
      return !result.metaDescription?.trim();
    case "missing_h1":
      if (result.h1Count === undefined) return undefined;
      return result.h1Count === 0;
    case "missing_alt":
      if (result.missingAltCount === undefined) return undefined;
      return result.missingAltCount > 0;
    case "duplicate_title":
      return undefined;
  }
}

export class IssueRechecker {
  constructor(private readonly deps: RecheckerDependencies) {}

  async recheck(issueId: string): Promise<RecheckOutcome> {
    const issue = this.deps.issues.get(issueId);
    if (!issue) throw new DomainError("Issue not found.", 404, "issue_not_found");
    if (issue.status === "pending_approval" || issue.status === "rejected") {
      throw new DomainError(
        `Issue must be approved before rechecking (status: ${issue.status}).`,
        409,
        "invalid_issue_state",
      );
    }
    if (issue.status === "fixed" && issue.trackerState === "closed") {
      return { issue, evidence: { alreadyFixed: true, checkedAt: issue.lastCheckedAt } };
    }

    let result: RecheckResult;
    try {
      result = await this.deps.probe.recheck(issue);
    } catch (error) {
      result = {
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      };
    }

    const checkedAt = result.checkedAt ?? new Date().toISOString();
    const outcome = result.outcome ?? "unknown";
    const unverifiedTransportFailure = outcome === "timeout" ||
      (outcome === "error" && result.statusCode == null);
    const stillPresent = unverifiedTransportFailure
      ? undefined
      : issueStillPresent(issue, result);
    const status = stillPresent === undefined
      ? "uncertain"
      : stillPresent
        ? "still_failing"
        : "fixed";

    const evidencePayload: Record<string, unknown> = {
      sourcePage: issue.sourceUrl,
      badUrl: issue.badUrl,
      issueType: issue.type,
      statusCode: result.statusCode ?? null,
      redirectChain: result.redirectChain ?? [],
      title: result.title ?? null,
      metaDescription: result.metaDescription ?? null,
      h1Count: result.h1Count ?? null,
      missingAltCount: result.missingAltCount ?? null,
      outcome,
      stillPresent: stillPresent ?? null,
      checkedAt,
      error: result.error ?? null,
      probeEvidence: result.evidence ?? {},
    };

    this.deps.evidence.record({
      issueId,
      kind: "recheck",
      payload: evidencePayload,
      capturedAt: checkedAt,
    });

    let trackerState = issue.trackerState;
    let trackerCloseWarning: string | undefined;
    if (status === "fixed") {
      if (issue.trackerId && issue.trackerUrl && trackerState !== "closed") {
        try {
          await this.deps.tracker.closeIssue({
            id: issue.trackerId,
            url: issue.trackerUrl,
            state: "open",
          });
          trackerState = "closed";
        } catch (error) {
          trackerState = "close_failed";
          trackerCloseWarning = error instanceof Error ? error.message : String(error);
        }
      } else if (!issue.trackerId) {
        trackerState = "not_filed";
      }
    }

    const updated = this.deps.issues.markRechecked(issueId, status, {
      statusCode: result.statusCode,
      redirectChain: result.redirectChain,
      trackerState,
    });
    return { issue: updated, trackerCloseWarning, evidence: evidencePayload };
  }
}
