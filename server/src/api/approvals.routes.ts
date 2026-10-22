import { Router } from "express";
import type { IssueFilingService } from "../agent/issueFiling";
import { sendApiError } from "./errors";
import { serializeIssue } from "./serializers";

export function createApprovalsRouter(filing: IssueFilingService): Router {
  const router = Router();

  router.post("/:id/approve", async (request, response) => {
    try {
      const issue = await filing.approveAndFile(request.params.id, "human");
      response.json({ issue: serializeIssue(issue), message: "Issue approved and filed." });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post("/:id/reject", (request, response) => {
    try {
      const issue = filing.reject(request.params.id, "human");
      response.json({ issue: serializeIssue(issue), message: "Issue rejected; no tracker action was taken." });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  return router;
}
