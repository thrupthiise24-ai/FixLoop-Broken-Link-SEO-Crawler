import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

/** redirectChain includes the source URL and each destination, so hops = nodes - 1. */
export function detectRedirectChains(snapshot: CrawlSnapshot): DetectorFinding[] {
  return snapshot.links.flatMap((link) => {
    if (link.internal === false) return [];
    const chain = link.redirectChain ?? [];
    const redirectHops = Math.max(0, chain.length - 1);
    if (redirectHops < 3) return [];
    return [{
      type: "redirect_chain" as const,
      sourceUrl: link.sourceUrl,
      badUrl: link.targetUrl,
      statusCode: link.statusCode,
      redirectChain: chain,
      outcome: link.outcome,
      checkedAt: link.checkedAt,
      severity: "medium" as const,
      evidence: { redirectHops, redirectChain: chain },
    }];
  });
}
