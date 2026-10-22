import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

export function detectMissingH1(snapshot: CrawlSnapshot): DetectorFinding[] {
  return snapshot.pages.flatMap((page) => {
    if (page.statusCode == null || page.statusCode >= 400) return [];
    if ((page.h1Count ?? 0) > 0) return [];
    return [{
      type: "missing_h1" as const,
      sourceUrl: page.url,
      badUrl: page.url,
      statusCode: page.statusCode,
      severity: "medium" as const,
      checkedAt: page.crawledAt,
      evidence: { h1Count: page.h1Count ?? 0 },
    }];
  });
}
