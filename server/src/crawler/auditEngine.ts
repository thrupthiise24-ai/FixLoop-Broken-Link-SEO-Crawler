import type {
  AuditEngine,
  CrawlPage,
  CrawlPlan,
  CrawlSnapshot,
  DetectorFinding,
  Issue,
  RecheckResult,
} from "../../../shared/types";
import { detectIssues } from "../detectors";
import { planSite } from "../agent/planner";
import { PoliteFetcher, type FetchResult, type FetcherOptions } from "./fetcher";
import { getPathScope, isSameOrigin, isWithinPathScope, normalizeSiteUrl, normalizeUrl } from "./normalizeUrl";
import { parseHtml, type ParsedPage } from "./parser";
import { RobotsPolicy } from "./robots";

export interface PageDocument {
  fetch: FetchResult;
  parsed: ParsedPage;
}

export type PageDocumentLoader = (url: string, forceRefresh?: boolean) => Promise<PageDocument>;

export interface HttpAuditEngineOptions extends FetcherOptions {
  cacheTtlMs?: number;
  maxLinkChecks?: number;
}

interface CacheEntry {
  document: PageDocument;
  storedAt: number;
}

const emptyParsedPage: ParsedPage = {
  title: null,
  metaDescription: null,
  h1Count: 0,
  imagesMissingAlt: [],
  links: [],
};

export class HttpAuditEngine implements AuditEngine {
  private readonly fetcher: PoliteFetcher;
  private readonly robots: RobotsPolicy;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly maxLinkChecks: number;

  constructor(options: HttpAuditEngineOptions = {}) {
    this.fetcher = new PoliteFetcher(options);
    this.robots = new RobotsPolicy(this.fetcher);
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.maxLinkChecks = options.maxLinkChecks ?? 1_000;
  }

  async plan(siteUrl: string, pageLimit: number): Promise<CrawlPlan> {
    const normalized = normalizeSiteUrl(siteUrl);
    return planSite(normalized, pageLimit, (url) => this.loadPage(url), this.robots);
  }

  async crawl(plan: CrawlPlan, pageLimit: number): Promise<CrawlSnapshot> {
    const selected = plan.pages.slice(0, pageLimit);
    const documents = new Map<string, PageDocument>();
    const pages: CrawlPage[] = [];

    for (const planned of selected) {
      const decision = await this.robots.isAllowed(planned.url);
      if (!decision.allowed) continue;
      const document = await this.loadPage(planned.url);
      documents.set(planned.url, document);
      pages.push(this.toCrawlPage(planned.url, planned.depth, planned.priority, planned.priorityReason, document));
    }

    const scopePath = getPathScope(plan.pages[0]?.url ?? "http://localhost/");
    const origin = plan.pages[0] ? new URL(plan.pages[0].url).origin : "";
    const linkEntries = pages.flatMap((page) => {
      const document = documents.get(page.url);
      return (document?.parsed.links ?? []).map((link) => ({ sourceUrl: page.url, link }));
    });
    const distinctTargets = Array.from(new Set(linkEntries.map(({ link }) => link.url)));
    const targetResults = new Map<string, FetchResult>();
    let checks = 0;

    for (const targetUrl of distinctTargets) {
      const sameOrigin = origin !== "" && isSameOrigin(targetUrl, origin);
      if (!sameOrigin || !isWithinPathScope(targetUrl, scopePath)) continue;
      if (checks >= this.maxLinkChecks) continue;
      const decision = await this.robots.isAllowed(targetUrl);
      if (!decision.allowed) continue;
      checks++;
      const cached = this.cache.get(targetUrl);
      if (cached && Date.now() - cached.storedAt <= this.cacheTtlMs) {
        targetResults.set(targetUrl, cached.document.fetch);
        continue;
      }
      // Link validation uses HEAD so out-of-plan targets are not crawled as
      // additional page documents. Fall back to GET only when HEAD is unsupported.
      targetResults.set(targetUrl, await this.probeTarget(targetUrl));
    }

    const checkedAt = new Date().toISOString();
    const links = linkEntries.map(({ sourceUrl, link }) => {
      const sameOrigin = origin !== "" && isSameOrigin(link.url, origin);
      const inScope = sameOrigin && isWithinPathScope(link.url, scopePath);
      const target = targetResults.get(link.url);
      return {
        sourceUrl,
        targetUrl: link.url,
        statusCode: target?.statusCode ?? null,
        redirectChain: target?.redirectChain ?? [],
        checkedAt: target?.checkedAt ?? checkedAt,
        outcome: target?.outcome ?? "unknown" as const,
        internal: sameOrigin,
        error: target?.error ?? (!target
          ? !sameOrigin
            ? "External target was not fetched; the crawl is scoped to the authorized site."
            : !inScope
              ? "Target is outside the configured path scope."
              : "Target was not checked (robots rule or link-check budget)."
          : undefined),
      };
    });

    return { pages, links, notCrawled: plan.notCrawled };
  }

  detect(snapshot: CrawlSnapshot): DetectorFinding[] {
    return detectIssues(snapshot);
  }

  async recheck(finding: DetectorFinding): Promise<RecheckResult> {
    const sourceUrl = normalizeUrl(finding.sourceUrl);
    const targetUrl = normalizeUrl(finding.badUrl, finding.sourceUrl);
    if (!sourceUrl || !targetUrl) {
      return { outcome: "error", error: "Issue URLs are not valid HTTP or HTTPS URLs." };
    }

    const sourceRobots = await this.robots.isAllowed(sourceUrl);
    if (!sourceRobots.allowed) {
      return { outcome: "error", error: sourceRobots.reason };
    }
    const source = await this.loadPage(sourceUrl, true);
    if (source.fetch.outcome === "timeout" || source.fetch.statusCode === null || source.fetch.statusCode >= 400) {
      return {
        outcome: source.fetch.outcome === "timeout" ? "timeout" : "error",
        statusCode: null,
        redirectChain: source.fetch.redirectChain,
        error: source.fetch.error ?? `Source page returned HTTP ${source.fetch.statusCode}.`,
        checkedAt: source.fetch.checkedAt,
        evidence: { sourceStatusCode: source.fetch.statusCode },
      };
    }

    if (finding.type === "broken_link") {
      const linkStillPresent = source.parsed.links.some((link) => normalizeUrl(link.url) === targetUrl);
      if (!linkStillPresent) {
        return {
          outcome: "ok",
          statusCode: source.fetch.statusCode,
          stillPresent: false,
          checkedAt: source.fetch.checkedAt,
          evidence: { sourcePageFetched: true, targetLinkPresent: false },
        };
      }
      const targetRobots = await this.robots.isAllowed(targetUrl);
      if (!targetRobots.allowed) {
        return { outcome: "error", error: targetRobots.reason, checkedAt: new Date().toISOString() };
      }
      const target = await this.probeTarget(targetUrl);
      return {
        outcome: target.outcome,
        statusCode: target.statusCode,
        redirectChain: target.redirectChain,
        stillPresent: target.statusCode === null ? undefined : target.statusCode >= 400,
        checkedAt: target.checkedAt,
        error: target.error,
        evidence: { sourcePageFetched: true, targetLinkPresent: true, targetFinalUrl: target.finalUrl },
      };
    }

    if (finding.type === "redirect_chain") {
      const targetRobots = await this.robots.isAllowed(targetUrl);
      if (!targetRobots.allowed) return { outcome: "error", error: targetRobots.reason };
      const target = await this.probeTarget(targetUrl);
      const redirectHops = Math.max(0, target.redirectChain.length - 1);
      return {
        outcome: target.outcome,
        statusCode: target.statusCode,
        redirectChain: target.redirectChain,
        stillPresent: target.statusCode === null ? undefined : redirectHops >= 3,
        checkedAt: target.checkedAt,
        error: target.error,
      };
    }

    return {
      outcome: source.fetch.outcome,
      statusCode: source.fetch.statusCode,
      title: source.parsed.title,
      metaDescription: source.parsed.metaDescription,
      h1Count: source.parsed.h1Count,
      missingAltCount: source.parsed.imagesMissingAlt.length,
      checkedAt: source.fetch.checkedAt,
      error: source.fetch.error,
      stillPresent: this.seoIssueStillPresent(finding, source.parsed),
    };
  }

  private async probeTarget(url: string): Promise<FetchResult> {
    const head = await this.fetcher.fetch(url, { method: "HEAD" });
    if (head.statusCode === 405 || head.statusCode === 501) {
      return this.fetcher.fetch(url, { method: "GET", readBody: false });
    }
    return head;
  }

  private async loadPage(url: string, forceRefresh = false): Promise<PageDocument> {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return {
        fetch: {
          requestedUrl: url,
          finalUrl: url,
          statusCode: null,
          redirectChain: [url],
          body: "",
          contentType: null,
          outcome: "error",
          error: "Invalid page URL.",
          checkedAt: new Date().toISOString(),
        },
        parsed: emptyParsedPage,
      };
    }
    const cached = this.cache.get(normalized);
    if (!forceRefresh && cached && Date.now() - cached.storedAt <= this.cacheTtlMs) return cached.document;

    const fetched = await this.fetcher.fetch(normalized);
    const isHtml = fetched.contentType?.toLowerCase().includes("text/html") ||
      fetched.contentType?.toLowerCase().includes("application/xhtml+xml");
    const parsed = isHtml && fetched.body ? parseHtml(fetched.body, normalized) : emptyParsedPage;
    const document = { fetch: fetched, parsed };
    this.cache.set(normalized, { document, storedAt: Date.now() });
    return document;
  }

  private toCrawlPage(
    url: string,
    depth: number,
    priority: number,
    priorityReason: string,
    document: PageDocument,
  ): CrawlPage {
    return {
      url,
      depth,
      priority,
      priorityReason,
      statusCode: document.fetch.statusCode,
      title: document.parsed.title,
      metaDescription: document.parsed.metaDescription,
      h1Count: document.parsed.h1Count,
      imagesMissingAlt: document.parsed.imagesMissingAlt,
      crawledAt: document.fetch.checkedAt,
      crawled: true,
    };
  }

  private seoIssueStillPresent(finding: DetectorFinding, parsed: ParsedPage): boolean | undefined {
    switch (finding.type) {
      case "missing_title":
        return !parsed.title;
      case "missing_meta_description":
        return !parsed.metaDescription;
      case "missing_h1":
        return parsed.h1Count === 0;
      case "missing_alt":
        return parsed.imagesMissingAlt.includes(finding.badUrl);
      case "duplicate_title":
        // Determining duplicates requires comparing with a broader crawl snapshot.
        return undefined;
      default:
        return undefined;
    }
  }
}

export function createHttpAuditEngine(options: HttpAuditEngineOptions = {}): HttpAuditEngine {
  return new HttpAuditEngine(options);
}

export function asFinding(issue: Issue): DetectorFinding {
  return {
    type: issue.type,
    sourceUrl: issue.sourceUrl,
    badUrl: issue.badUrl,
    statusCode: issue.statusCode,
    redirectChain: issue.redirectChain,
  };
}
