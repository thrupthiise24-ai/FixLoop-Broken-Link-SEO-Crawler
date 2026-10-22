export interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
}

export class RobotsParser {
  private rules: RobotsRule[] = [];
  private sitemaps: string[] = [];

  constructor(content?: string) {
    if (content) {
      this.parse(content);
    }
  }

  public static async loadFromSite(siteUrl: string, fetchFn?: (url: string) => Promise<{ statusCode: number; bodyText?: string }>): Promise<RobotsParser> {
    try {
      const robotsUrl = new URL('/robots.txt', siteUrl).toString();
      let text = '';
      if (fetchFn) {
        const res = await fetchFn(robotsUrl);
        if (res.statusCode === 200 && res.bodyText) {
          text = res.bodyText;
        }
      } else {
        const res = await fetch(robotsUrl);
        if (res.status === 200) {
          text = await res.text();
        }
      }
      return new RobotsParser(text);
    } catch {
      // Default to permissive if robots.txt cannot be fetched
      return new RobotsParser('');
    }
  }

  public parse(content: string): void {
    this.rules = [];
    this.sitemaps = [];

    const lines = content.split(/\r?\n/);
    let currentAgents: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const directive = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      if (directive === 'user-agent') {
        const agent = value.toLowerCase();
        currentAgents = [agent];
        let existing = this.rules.find((r) => r.userAgent === agent);
        if (!existing) {
          this.rules.push({ userAgent: agent, disallow: [], allow: [] });
        }
      } else if (directive === 'disallow') {
        if (value) {
          for (const agent of currentAgents) {
            let rule = this.rules.find((r) => r.userAgent === agent);
            if (!rule) {
              rule = { userAgent: agent, disallow: [], allow: [] };
              this.rules.push(rule);
            }
            rule.disallow.push(value);
          }
        }
      } else if (directive === 'allow') {
        if (value) {
          for (const agent of currentAgents) {
            let rule = this.rules.find((r) => r.userAgent === agent);
            if (!rule) {
              rule = { userAgent: agent, disallow: [], allow: [] };
              this.rules.push(rule);
            }
            rule.allow.push(value);
          }
        }
      } else if (directive === 'sitemap') {
        this.sitemaps.push(value);
      }
    }
  }

  public isAllowed(url: string, userAgent: string = '*'): boolean {
    if (this.rules.length === 0) return true;

    let path: string;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search;
    } catch {
      path = url;
    }

    const agentLower = userAgent.toLowerCase();
    const specificRule = this.rules.find((r) => r.userAgent === agentLower);
    const wildcardRule = this.rules.find((r) => r.userAgent === '*');

    const effectiveRule = specificRule || wildcardRule;
    if (!effectiveRule) return true;

    // Check allow rules first (most specific match)
    for (const allowedPath of effectiveRule.allow) {
      if (this.matchesPath(path, allowedPath)) {
        return true;
      }
    }

    // Check disallow rules
    for (const disallowedPath of effectiveRule.disallow) {
      if (this.matchesPath(path, disallowedPath)) {
        return false;
      }
    }

    return true;
  }

  private matchesPath(targetPath: string, rulePattern: string): boolean {
    if (rulePattern === '/') return true;
    if (rulePattern.endsWith('$')) {
      const pattern = rulePattern.slice(0, -1);
      return targetPath === pattern;
    }
    return targetPath.startsWith(rulePattern);
  }

  public getSitemaps(): string[] {
    return this.sitemaps;
  }
}
