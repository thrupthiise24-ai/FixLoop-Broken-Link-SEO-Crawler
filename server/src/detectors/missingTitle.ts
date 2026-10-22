import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

export function detectMissingTitles(snapshot: CrawlSnapshot): DetectorFinding[] {
  return snapshot.pages.flatMap((page) => {
    if (page.statusCode == null || page.statusCode >= 400) return [];
    if (page.title?.trim()) return [];
    return [{
      type: "missing_title" as const,
      sourceUrl: page.url,
      badUrl: page.url,
      statusCode: page.statusCode,
      severity: "medium" as const,
      checkedAt: page.crawledAt,
      evidence: { title: page.title ?? null },
    }];
  });
}
