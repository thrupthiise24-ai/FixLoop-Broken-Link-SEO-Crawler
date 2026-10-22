import { Page } from '../../../shared/types.js';

export interface PriorityEvaluation {
  score: number;
  reason: string;
}

export interface PlanSummary {
  siteUrl: string;
  pageLimit: number;
  plannedCount: number;
  skippedCount: number;
  prioritizedPages: Array<{
    url: string;
    depth: number;
    priority: number;
    priorityReason: string;
  }>;
  notCrawledList: Array<{
    url: string;
    depth: number;
    reason: string;
  }>;
}

export class Planner {
  private pageLimit: number;

  constructor(pageLimit: number = 200) {
    this.pageLimit = pageLimit;
  }

  /**
   * Computes an agentic priority score and explanation for why a page should be crawled earlier.
   */
  public evaluatePriority(
    url: string,
    depth: number,
    isNav: boolean = false,
    inboundCount: number = 1
  ): PriorityEvaluation {
    let score = 500;
    const reasons: string[] = [];

    // Root/home page evaluation
    let pathname = '/';
    try {
      pathname = new URL(url).pathname;
    } catch {}

    if (depth === 0 || pathname === '/' || pathname === '') {
      score += 500;
      reasons.push('Root home page (highest crawl priority)');
      return { score, reason: reasons.join('; ') };
    }

    // Depth penalty: shallower pages have higher priority
    const depthPenalty = depth * 60;
    score -= depthPenalty;
    reasons.push(`Depth level ${depth} (-${depthPenalty} pts)`);

    // Navigation links bonus
    if (isNav) {
      score += 200;
      reasons.push('Navigation/header link (+200 pts)');
    }

    // Inbound popularity bonus
    if (inboundCount > 1) {
      const inboundBonus = Math.min((inboundCount - 1) * 15, 150);
      score += inboundBonus;
      reasons.push(`Referenced by ${inboundCount} pages (+${inboundBonus} pts)`);
    }

    // Key architectural pages bonus
    const keyPatterns = ['/about', '/pricing', '/contact', '/docs', '/blog', '/products', '/features'];
    if (keyPatterns.some((pattern) => pathname.toLowerCase().startsWith(pattern))) {
      score += 50;
      reasons.push('Core marketing/documentation path (+50 pts)');
    }

    // Deep pagination or utility pages penalty
    if (pathname.includes('/page/') || pathname.includes('/tag/') || pathname.includes('?page=')) {
      score -= 80;
      reasons.push('Deep archive/pagination path (-80 pts)');
    }

    return {
      score: Math.max(score, 1),
      reason: reasons.join('; '),
    };
  }

  /**
   * Applies the page limit (e.g. TC3 crawl limit of 200 pages) and records the not-crawled list.
   */
  public partitionByLimit(
    items: Array<{
      url: string;
      depth: number;
      priority: number;
      priorityReason: string;
    }>,
    alreadyCrawledCount: number = 0
  ): {
    canCrawl: Array<{
      url: string;
      depth: number;
      priority: number;
      priorityReason: string;
    }>;
    notCrawled: Array<{
      url: string;
      depth: number;
      reason: string;
    }>;
  } {
    const remainingSlots = Math.max(this.pageLimit - alreadyCrawledCount, 0);

    const canCrawl = items.slice(0, remainingSlots);
    const notCrawled = items.slice(remainingSlots).map((item) => ({
      url: item.url,
      depth: item.depth,
      reason: `Crawl page limit of ${this.pageLimit} reached. Page ranked #${items.indexOf(item) + 1} with priority score ${item.priority}.`,
    }));

    return { canCrawl, notCrawled };
  }

  /**
   * Formats a page entity ready for DB persistence.
   */
  public createPlannedPage(
    runId: string,
    url: string,
    depth: number,
    priority: number,
    priorityReason: string
  ): Page {
    return {
      id: crypto.randomUUID(),
      run_id: runId,
      url,
      depth,
      priority,
      priority_reason: priorityReason,
      crawled: false,
    };
  }
}
