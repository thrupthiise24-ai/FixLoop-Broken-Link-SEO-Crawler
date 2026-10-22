import { Router } from "express";
import type { EvidenceRepository, IssueRepository } from "../db/repositories";
import type { IssueRechecker } from "../agent/recheck";
import { DomainError } from "../agent/domainError";
import { sendApiError } from "./errors";
import { serializeIssue } from "./serializers";

export interface IssuesRouterDependencies {
  issues: IssueRepository;
  evidence: EvidenceRepository;
  rechecker?: IssueRechecker;
}

export function createIssuesRouter(deps: IssuesRouterDependencies): Router {
  const router = Router();

  router.get("/:id", (request, response) => {
    const issue = deps.issues.get(request.params.id);
    if (!issue) {
      response.status(404).json({ error: "issue_not_found", message: "Issue not found." });
      return;
    }
    response.json({
      issue: serializeIssue({ ...issue, evidence: deps.evidence.listForIssue(issue.id) }),
    });
  });

  router.get("/:id/evidence", (request, response) => {
    if (!deps.issues.get(request.params.id)) {
      response.status(404).json({ error: "issue_not_found", message: "Issue not found." });
      return;
    }
    response.json({ evidence: deps.evidence.listForIssue(request.params.id) });
  });

  router.post("/:id/recheck", async (request, response) => {
    if (!deps.rechecker) {
      sendApiError(response, new DomainError(
        "The crawler re-check adapter has not been connected yet.",
        503,
        "rechecker_not_ready",
      ));
      return;
    }
    try {
      const result = await deps.rechecker.recheck(request.params.id);
      response.json({
        issue: serializeIssue({
          ...result.issue,
          evidence: deps.evidence.listForIssue(result.issue.id),
        }),
        evidence: result.evidence,
        tracker_close_warning: result.trackerCloseWarning ?? null,
        message: result.trackerCloseWarning
          ? `The site issue is verified fixed, but the tracker could not be closed: ${result.trackerCloseWarning}`
          : `Recheck completed: ${result.issue.status}.`,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  return router;
}
