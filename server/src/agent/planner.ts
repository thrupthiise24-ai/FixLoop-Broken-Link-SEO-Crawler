import type { CrawlPlan, NotCrawledPage, PlannedPage } from "../../../shared/types";
import type { RobotsPolicy } from "../crawler/robots";
import { getPathScope, isSameOrigin, isWithinPathScope, normalizeSiteUrl, normalizeUrl } from "../crawler/normalizeUrl";
import { PriorityQueue, type QueueItem } from "../crawler/queue";
import type { PageDocumentLoader } from "../crawler/auditEngine";

interface PlanCandidate extends QueueItem {
  parentUrl: string;
}

function priorityFor(candidate: {
  url: string;
  depth: number;
  inboundCount: number;
  isNavigation: boolean;
  startUrl: string;
}): { priority: number; reason: string } {
  if (candidate.url === candidate.startUrl) {
    return { priority: 1000, reason: "Seed URL: the site entry point is crawled first." };
  }
  const depthScore = Math.max(0, 100 - candidate.depth * 8);
  const inboundScore = Math.min(candidate.inboundCount, 20) * 3;
  if (candidate.isNavigation) {
    return {
      priority: 800 + depthScore + inboundScore,
      reason: `Navigation link, depth ${candidate.depth}, ${candidate.inboundCount} inbound link(s).`,
    };
  }
  return {
    priority: 400 + depthScore + inboundScore,
    reason: `Depth ${candidate.depth}, ${candidate.inboundCount} inbound link(s).`,
  };
}

/**
 * Crawl a small discovery frontier, rank its pages, and return every known page
 * that could not fit the requested cap. The loader caches fetched pages for the
 * following crawl phase so the planning pass does not double-fetch them.
 */
export async function planSite(
  rawSiteUrl: string,
  pageLimit: number,
  loadPage: PageDocumentLoader,
  robots: RobotsPolicy,
): Promise<CrawlPlan> {
  const startUrl = normalizeSiteUrl(rawSiteUrl);
  const origin = new URL(startUrl).origin;
  const scopePath = getPathScope(startUrl);
  const queue = new PriorityQueue<PlanCandidate>();
  const queued = new Set<string>();
  const visited = new Set<string>();
  const inboundCounts = new Map<string, number>();
  const navLinks = new Set<string>();
  const notCrawled: NotCrawledPage[] = [];
  const pages: PlannedPage[] = [];
  const candidateData = new Map<string, { depth: number; parentUrl: string }>();

  const seedPriority = priorityFor({
    url: startUrl,
    depth: 0,
    inboundCount: 0,
    isNavigation: false,
    startUrl,
  });
  queue.push({ url: startUrl, depth: 0, priority: seedPriority.priority, priorityReason: seedPriority.reason, parentUrl: startUrl });
  queued.add(startUrl);
  candidateData.set(startUrl, { depth: 0, parentUrl: startUrl });

  while (queue.size > 0 && pages.length < pageLimit) {
    const candidate = queue.pop();
    if (!candidate || visited.has(candidate.url)) continue;
    visited.add(candidate.url);

    const decision = await robots.isAllowed(candidate.url);
    if (!decision.allowed) {
      notCrawled.push({ url: candidate.url, reason: decision.reason });
      continue;
    }

    const document = await loadPage(candidate.url);
    pages.push({
      url: candidate.url,
      depth: candidate.depth,
      priority: candidate.priority,
      priorityReason: candidate.priorityReason,
      status: "planned",
    });

    for (const link of document.parsed.links) {
      if (!link.internal || !isSameOrigin(link.url, origin) || !isWithinPathScope(link.url, scopePath)) continue;
      if (link.url === candidate.url) continue;

      const nextDepth = candidate.depth + 1;
      const nextInbound = (inboundCounts.get(link.url) ?? 0) + 1;
      inboundCounts.set(link.url, nextInbound);
      if (link.isNavigation) navLinks.add(link.url);
      const isNavigation = navLinks.has(link.url);
      const score = priorityFor({
        url: link.url,
        depth: nextDepth,
        inboundCount: nextInbound,
        isNavigation,
        startUrl,
      });
      const existing = candidateData.get(link.url);
      const depth = existing ? Math.min(existing.depth, nextDepth) : nextDepth;
      const parentUrl = existing?.parentUrl ?? candidate.url;
      candidateData.set(link.url, { depth, parentUrl });
      if (!visited.has(link.url)) {
        queued.add(link.url);
        queue.push({
          url: link.url,
          depth,
          priority: score.priority,
          priorityReason: score.reason,
          isNavigation,
          parentUrl,
        });
      }
    }
  }

  for (const candidate of queue.values()) {
    if (!queued.has(candidate.url) || visited.has(candidate.url)) continue;
    notCrawled.push({
      url: candidate.url,
      reason: `Page limit reached (${pageLimit} pages); ranked below the selected crawl plan.`,
    });
  }

  // A URL can be discovered repeatedly from separate pages; report it once.
  const uniqueNotCrawled = new Map<string, NotCrawledPage>();
  for (const item of notCrawled) {
    if (!item.url || pages.some((page) => page.url === item.url)) continue;
    if (!uniqueNotCrawled.has(item.url)) uniqueNotCrawled.set(item.url, item);
  }

  return {
    pages,
    notCrawled: Array.from(uniqueNotCrawled.values()),
  };
}
