import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

export function detectMissingImageAlt(snapshot: CrawlSnapshot): DetectorFinding[] {
  return snapshot.pages.flatMap((page) => {
    if (page.statusCode == null || page.statusCode >= 400) return [];
    return (page.imagesMissingAlt ?? []).map((imageUrl) => ({
      type: "missing_alt" as const,
      sourceUrl: page.url,
      badUrl: imageUrl,
      statusCode: page.statusCode,
      severity: "low" as const,
      checkedAt: page.crawledAt,
      evidence: { imageUrl, altAttribute: "missing" },
    }));
  });
}
