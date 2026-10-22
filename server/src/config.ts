import { join, resolve } from "node:path";

export interface ServerConfig {
  port: number;
  databasePath: string;
  maxPageLimit: number;
  githubToken?: string;
  githubRepository?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  nodeEnv: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const maxPages = Math.min(positiveInteger(env.MAX_CRAWL_PAGES, 200), 200);
  const databasePath = env.DATABASE_PATH
    ? resolve(env.DATABASE_PATH)
    : join(process.cwd(), "data", "fixloop.sqlite");

  return {
    port: positiveInteger(env.PORT, 3002),
    databasePath,
    maxPageLimit: maxPages,
    githubToken: env.GITHUB_TOKEN || undefined,
    githubRepository: env.GITHUB_REPOSITORY || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
    nodeEnv: env.NODE_ENV || "development",
  };
}
