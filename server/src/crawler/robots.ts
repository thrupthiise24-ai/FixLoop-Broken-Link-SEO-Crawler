import { PoliteFetcher } from "./fetcher";

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsPolicyData {
  rules: RobotsRule[];
  denyAll: boolean;
  crawlDelayMs: number;
}

export interface RobotsDecision {
  allowed: boolean;
  reason: string;
}

function parseRobots(text: string): RobotsPolicyData {
  const lines = text.split(/\r?\n/).map((line) => line.split("#", 1)[0].trim());
  const rules: RobotsRule[] = [];
  let active = false;
  let hasDirective = false;
  let crawlDelayMs = 0;

  for (const line of lines) {
    if (!line || !line.includes(":")) continue;
    const [rawName, ...rawValue] = line.split(":");
    const name = rawName.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (name === "user-agent") {
      if (hasDirective) {
        active = false;
        hasDirective = false;
      }
      const agent = value.toLowerCase();
      active = agent === "*" || agent.includes("fixloopbot");
      continue;
    }
    if (name === "allow" || name === "disallow") {
      hasDirective = true;
      if (active && value) rules.push({ allow: name === "allow", pattern: value });
      continue;
    }
    if (name === "crawl-delay" && active) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.min(seconds * 1000, 30000);
    }
  }
  return { rules, denyAll: false, crawlDelayMs };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchoredEnd = pattern.endsWith("$");
  const source = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const suffix = anchoredEnd ? "" : ".*";
  return new RegExp(`^${escaped}${suffix}`).test(path);
}

export class RobotsPolicy {
  private readonly cache = new Map<string, Promise<RobotsPolicyData>>();

  constructor(private readonly fetcher: PoliteFetcher) {}

  async isAllowed(url: string): Promise<RobotsDecision> {
    const parsed = new URL(url);
    const policy = await this.load(parsed.origin);
    if (policy.denyAll) return { allowed: false, reason: "robots.txt could not be read safely." };

    const path = `${parsed.pathname}${parsed.search}`;
    const matches = policy.rules
      .filter((rule) => ruleMatches(rule.pattern, path))
      .sort((left, right) => right.pattern.length - left.pattern.length);
    if (matches.length === 0) return { allowed: true, reason: "No matching robots.txt rule." };
    const rule = matches[0];
    return rule.allow
      ? { allowed: true, reason: `Allowed by robots.txt rule ${rule.pattern}.` }
      : { allowed: false, reason: `Disallowed by robots.txt rule ${rule.pattern}.` };
  }

  private load(origin: string): Promise<RobotsPolicyData> {
    const existing = this.cache.get(origin);
    if (existing) return existing;
    const promise = this.fetcher.fetch(new URL("/robots.txt", origin).toString()).then((result) => {
      if (result.statusCode === 404 || result.statusCode === 410) {
        return { rules: [], denyAll: false, crawlDelayMs: 0 };
      }
      if (result.statusCode === null || result.statusCode >= 500 || result.outcome === "timeout") {
        return { rules: [], denyAll: true, crawlDelayMs: 0 };
      }
      if (result.statusCode >= 400) return { rules: [], denyAll: false, crawlDelayMs: 0 };
      const policy = parseRobots(result.body);
      this.fetcher.setOriginCrawlDelay(origin, policy.crawlDelayMs);
      return policy;
    }).catch(() => ({ rules: [], denyAll: true, crawlDelayMs: 0 }));
    this.cache.set(origin, promise);
    return promise;
  }
}
