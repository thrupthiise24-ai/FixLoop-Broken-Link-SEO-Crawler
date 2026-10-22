import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { ServerConfig } from "../config";
import type { DemoSite } from "../../../demo-site/generate";
import { createDemoSiteRouter } from "./demoSite.routes";
import type {
  EvidenceRepository,
  IssueRepository,
  RunRepository,
  TestResultsRepository,
} from "../db/repositories";
import type { AuditOrchestrator } from "../agent/orchestrator";
import type { IssueFilingService } from "../agent/issueFiling";
import type { IssueRechecker } from "../agent/recheck";
import { createApprovalsRouter } from "./approvals.routes";
import { createDemoRouter, type DemoRouteDependencies } from "./demo.routes";
import { createIssuesRouter } from "./issues.routes";
import { createRunsRouter } from "./runs.routes";
import { serializeTestResult } from "./serializers";

export interface AppDependencies {
  config: ServerConfig;
  runs: RunRepository;
  issues: IssueRepository;
  evidence: EvidenceRepository;
  testResults: TestResultsRepository;
  filing: IssueFilingService;
  orchestrator?: AuditOrchestrator;
  rechecker?: IssueRechecker;
  demo?: DemoRouteDependencies;
  demoSite: DemoSite;
}

function appPreviewUrl(request: Request): string | undefined {
  const host = (request.get("x-forwarded-host") ?? request.get("host") ?? "")
    .split(",")[0]
    .trim();

  // The API has its own preview port; send browser visits to the paired UI.
  if (/^3002-[a-z0-9-]+\.e2b\.app$/i.test(host)) {
    return `https://${host.replace(/^3002-/i, "3001-")}/`;
  }
  if (/^(localhost|127\.0\.0\.1)(:3002)?$/i.test(host)) {
    return `http://${host.replace(/:3002$/i, ":3001")}/`;
  }
  return undefined;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  // Run state changes constantly; browsers must not heuristically cache API JSON
  // or the run-detail page's own polling would keep serving the stale body.
  app.use("/api", (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/", (request, response) => {
    const appUrl = appPreviewUrl(request);
    if (appUrl) {
      response.redirect(302, appUrl);
      return;
    }
    response.json({
      service: "fixloop-api",
      message: "The FixLoop UI is on port 3001. Use /api/health to check the API.",
    });
  });
  app.get("/robots.txt", (_request, response) => {
    response.type("text/plain").send("User-agent: *\nAllow: /demo/\nDisallow: /api/\nCrawl-delay: 0.02\n");
  });
  app.use("/demo", createDemoSiteRouter(deps.demoSite));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "fixloop-api", crawler_ready: Boolean(deps.orchestrator) });
  });

  app.get("/api/test-results", (_request, response) => {
    response.json({ results: deps.testResults.listLatest().map(serializeTestResult) });
  });

  app.post("/api/test-results", (request, response) => {
    const body = request.body && typeof request.body === "object"
      ? request.body as Record<string, unknown>
      : {};
    const results = Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) {
      response.status(400).json({ error: "invalid_results", message: "Provide a non-empty results array." });
      return;
    }

    const knownCases = new Set(["TC1", "TC2", "TC3", "TC4"]);
    const saved = [];
    for (const raw of results) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const testCase = typeof item.id === "string" ? item.id : item.testCase;
      const status = typeof item.status === "string" ? item.status.toUpperCase() : "";
      if (!knownCases.has(String(testCase)) || !["PASS", "FAIL"].includes(status)) continue;
      if (typeof item.input !== "string" || typeof item.expected !== "string" || typeof item.actual !== "string") continue;
      const evidence = Array.isArray(item.evidence)
        ? item.evidence.filter((value): value is string => typeof value === "string")
        : typeof item.evidence === "string" ? [item.evidence] : [];
      saved.push(deps.testResults.record({
        testCase: testCase as "TC1" | "TC2" | "TC3" | "TC4",
        input: item.input,
        expected: item.expected,
        actual: item.actual,
        passed: status === "PASS",
        evidence,
        notes: typeof item.notes === "string" ? item.notes : null,
      }));
    }
    if (saved.length === 0) {
      response.status(400).json({ error: "invalid_results", message: "No valid PASS/FAIL test results were supplied." });
      return;
    }
    response.status(201).json({ results: saved.map(serializeTestResult) });
  });

  app.use(
    "/api/runs",
    createRunsRouter({
      runs: deps.runs,
      issues: deps.issues,
      evidence: deps.evidence,
      orchestrator: deps.orchestrator,
      maxPageLimit: deps.config.maxPageLimit,
    }),
  );
  app.use("/api/issues", createApprovalsRouter(deps.filing));
  app.use(
    "/api/issues",
    createIssuesRouter({ issues: deps.issues, evidence: deps.evidence, rechecker: deps.rechecker }),
  );
  app.use("/api/demo", createDemoRouter(deps.demo));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: "not_found", message: "API route not found." });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error("Unhandled API error:", error);
    response.status(500).json({ error: "internal_error", message: "Unexpected server error." });
  });

  return app;
}
