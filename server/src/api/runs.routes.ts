import { Router } from "express";
import type { EvidenceRepository, IssueRepository, RunRepository } from "../db/repositories";
import type { AuditOrchestrator } from "../agent/orchestrator";
import { serializeIssue, serializeRootCauseGroup, serializeRun } from "./serializers";

export interface RunsRouterDependencies {
  runs: RunRepository;
  issues: IssueRepository;
  evidence: EvidenceRepository;
  orchestrator?: AuditOrchestrator;
  maxPageLimit: number;
}

export function createRunsRouter(deps: RunsRouterDependencies): Router {
  const router = Router();

  router.post("/", async (request, response) => {
    const body = request.body && typeof request.body === "object"
      ? request.body as Record<string, unknown>
      : {};

    if (body.permission_confirmed !== true) {
      response.status(403).json({
        error: "permission_required",
        message: "Confirm that you own this website or have permission to crawl it.",
      });
      return;
    }

    if (!deps.orchestrator) {
      response.status(503).json({
        error: "crawler_not_ready",
        message: "The run API is ready, but the crawler adapter has not been connected yet.",
      });
      return;
    }

    const rawSiteUrl = typeof body.site_url === "string" ? body.site_url.trim() : "";
    let siteUrl: string;
    try {
      const parsed = new URL(rawSiteUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("Unsupported URL");
      }
      siteUrl = parsed.toString();
    } catch {
      response.status(400).json({
        error: "invalid_site_url",
        message: "Enter a valid HTTP or HTTPS site URL without credentials.",
      });
      return;
    }

    const rawLimit = body.page_limit === undefined ? 200 : body.page_limit;
    if (typeof rawLimit !== "number" || !Number.isInteger(rawLimit) || rawLimit < 1) {
      response.status(400).json({
        error: "invalid_page_limit",
        message: "page_limit must be a positive whole number.",
      });
      return;
    }
    if (rawLimit > deps.maxPageLimit) {
      response.status(400).json({
        error: "page_limit_exceeded",
        message: `The maximum configured crawl limit is ${deps.maxPageLimit} pages.`,
      });
      return;
    }

    try {
      const run = deps.runs.create({
        siteUrl,
        pageLimit: rawLimit,
        permissionConfirmed: true,
      });
      // Runs return quickly; the orchestrator persists progress and final errors.
      void deps.orchestrator.executeRun(run.id).catch((error) => {
        console.error(`Run ${run.id} failed:`, error);
      });
      response.status(202).json({
        id: run.id,
        run_id: run.id,
        run: serializeRun(run),
        message: "Audit accepted. The agent is planning and crawling the site.",
      });
    } catch (error) {
      response.status(500).json({
        error: "run_creation_failed",
        message: error instanceof Error ? error.message : "Unable to create the run.",
      });
    }
  });

  router.get("/:id", (request, response) => {
    const run = deps.runs.get(request.params.id);
    if (!run) {
      response.status(404).json({ error: "run_not_found", message: "Run not found." });
      return;
    }
    response.json({ run: serializeRun(run) });
  });

  router.get("/:id/issues", (request, response) => {
    if (!deps.runs.get(request.params.id)) {
      response.status(404).json({ error: "run_not_found", message: "Run not found." });
      return;
    }
    const issues = deps.issues.listByRun(request.params.id).map((issue) => ({
      ...issue,
      evidence: deps.evidence.listForIssue(issue.id),
    }));
    const rootCauseGroups = deps.issues.listRootCauseGroups(request.params.id);
    response.json({
      issues: issues.map(serializeIssue),
      root_cause_groups: rootCauseGroups.map(serializeRootCauseGroup),
    });
  });

  return router;
}
