import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

export function detectMissingMetaDescriptions(snapshot: CrawlSnapshot): DetectorFinding[] {
  return snapshot.pages.flatMap((page) => {
    if (page.statusCode == null || page.statusCode >= 400) return [];
    if (page.metaDescription?.trim()) return [];
    return [{
      type: "missing_meta_description" as const,
      sourceUrl: page.url,
      badUrl: page.url,
      statusCode: page.statusCode,
      severity: "low" as const,
      checkedAt: page.crawledAt,
      evidence: { metaDescription: page.metaDescription ?? null },
    }];
  });
}
