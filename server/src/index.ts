import dotenv from "dotenv";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
import type { AuditEngine, DetectorFinding } from "../../shared/types";
import { createDemoSite, type DemoSite } from "../../demo-site/generate";
import { createHttpAuditEngine } from "./crawler/auditEngine";
import { loadConfig, type ServerConfig } from "./config";
import { createApp } from "./api/app";
import { AuditOrchestrator } from "./agent/orchestrator";
import { IssueFilingService } from "./agent/issueFiling";
import { IssueDrafter } from "./agent/issueDrafter";
import { IssueRechecker } from "./agent/recheck";
import { closeDatabase, openDatabase, type SqliteDatabase } from "./db/client";
import {
  EvidenceRepository,
  IssueRepository,
  LinkRepository,
  PageRepository,
  RunRepository,
  TestResultsRepository,
} from "./db/repositories";
import { createTracker } from "./integrations";

export interface CreateServerOptions {
  config?: ServerConfig;
  db?: SqliteDatabase;
  engine?: AuditEngine;
  demoFixBrokenLink?: () => Promise<{ changed: boolean; message?: string }> | { changed: boolean; message?: string };
  demoSite?: DemoSite;
}

export interface FixLoopServer {
  app: ReturnType<typeof createApp>;
  db: SqliteDatabase;
  demoSite: DemoSite;
  close: () => void;
}

/**
 * The production server uses the built-in HTTP crawler/planner/detectors by
 * default. Tests and alternate crawler adapters can inject an AuditEngine.
 */
export function createServer(options: CreateServerOptions = {}): FixLoopServer {
  const config = options.config ?? loadConfig();
  const db = options.db ?? openDatabase(config.databasePath);
  const demoSite = options.demoSite ?? createDemoSite();
  const engine = options.engine ?? createHttpAuditEngine();
  const runs = new RunRepository(db);
  const pages = new PageRepository(db);
  const links = new LinkRepository(db, pages);
  const issues = new IssueRepository(db);
  const evidence = new EvidenceRepository(db);
  const testResults = new TestResultsRepository(db);
  const tracker = createTracker(config, db);
  const filing = new IssueFilingService({ issues, tracker });
  const drafter = new IssueDrafter({
    apiKey: config.anthropicApiKey,
    model: config.anthropicModel,
  });

  const orchestrator = new AuditOrchestrator({
    runs,
    pages,
    links,
    issues,
    evidence,
    engine,
    drafter,
    maxPageLimit: config.maxPageLimit,
  });

  const rechecker = engine.recheck
    ? new IssueRechecker({
        issues,
        evidence,
        tracker,
        probe: {
          recheck: (issue) => {
            const finding: DetectorFinding = {
              type: issue.type,
              sourceUrl: issue.sourceUrl,
              badUrl: issue.badUrl,
              statusCode: issue.statusCode,
              redirectChain: issue.redirectChain,
            };
            return engine.recheck!(finding);
          },
        },
      })
    : undefined;

  const app = createApp({
    config,
    runs,
    issues,
    evidence,
    testResults,
    filing,
    orchestrator,
    rechecker,
    demo: {
      fixBrokenLink: options.demoFixBrokenLink ?? (() => demoSite.fixBrokenLink()),
      reset: () => {
        demoSite.reset();
        return { changed: true, message: "Demo scenario reset to its planted broken-link state." };
      },
    },
    demoSite,
  });

  return {
    app,
    db,
    demoSite,
    close: () => {
      if (!options.db) closeDatabase(db);
    },
  };
}

function loadAuditEngineFromEnvironment(): AuditEngine | undefined {
  const modulePath = process.env.AUDIT_ENGINE_MODULE;
  if (!modulePath) return undefined;
  const loaded = require(resolve(process.cwd(), modulePath)) as Record<string, unknown>;
  const exported = loaded.createAuditEngine ?? loaded.default ?? loaded.engine;
  const engine = typeof exported === "function"
    ? (exported as () => unknown)()
    : exported;
  if (!engine || typeof engine !== "object") {
    throw new Error("AUDIT_ENGINE_MODULE must export an AuditEngine, default engine, or createAuditEngine() factory.");
  }
  const candidate = engine as Partial<AuditEngine>;
  if (typeof candidate.plan !== "function" || typeof candidate.crawl !== "function" || typeof candidate.detect !== "function") {
    throw new Error("The AUDIT_ENGINE_MODULE export does not implement plan(), crawl(), and detect().");
  }
  return candidate as AuditEngine;
}

if (require.main === module) {
  const config = loadConfig();
  const engine = loadAuditEngineFromEnvironment();
  const service = createServer({ config, engine });
  const server: Server = service.app.listen(config.port, "0.0.0.0", () => {
    console.log(`FixLoop API listening on 0.0.0.0:${config.port}`);
    if (!engine) {
      console.log("Using the built-in HTTP crawler, planner, parser, and detectors.");
    }
  });

  const shutdown = () => {
    server.close(() => {
      service.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
