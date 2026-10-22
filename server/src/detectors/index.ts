import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";
import { detectBrokenLinks } from "./brokenLinks";
import { detectMissingH1 } from "./headings";
import { detectMissingImageAlt } from "./imageAlt";
import { detectMissingMetaDescriptions } from "./metaDescription";
import { detectMissingTitles } from "./missingTitle";
import { detectRedirectChains } from "./redirectChains";

export { detectBrokenLinks } from "./brokenLinks";
export { detectMissingH1 } from "./headings";
export { detectMissingImageAlt } from "./imageAlt";
export { detectMissingMetaDescriptions } from "./metaDescription";
export { detectMissingTitles } from "./missingTitle";
export { detectRedirectChains } from "./redirectChains";

function detectDuplicateTitles(snapshot: CrawlSnapshot): DetectorFinding[] {
  const titleGroups = new Map<string, typeof snapshot.pages>();
  for (const page of snapshot.pages) {
    if (page.statusCode == null || page.statusCode >= 400 || !page.title?.trim()) continue;
    const title = page.title.trim().toLocaleLowerCase();
    const group = titleGroups.get(title) ?? [];
    group.push(page);
    titleGroups.set(title, group);
  }

  const findings: DetectorFinding[] = [];
  for (const [title, pages] of titleGroups) {
    if (pages.length < 2) continue;
    const sourceUrls = pages.map((page) => page.url);
    for (const page of pages.slice(1)) {
      findings.push({
        type: "duplicate_title",
        sourceUrl: page.url,
        badUrl: page.url,
        statusCode: page.statusCode,
        severity: "medium",
        checkedAt: page.crawledAt,
        evidence: { title, duplicateSourcePages: sourceUrls },
      });
    }
  }
  return findings;
}

export function detectIssues(snapshot: CrawlSnapshot): DetectorFinding[] {
  return [
    ...detectBrokenLinks(snapshot),
    ...detectRedirectChains(snapshot),
    ...detectMissingTitles(snapshot),
    ...detectDuplicateTitles(snapshot),
    ...detectMissingMetaDescriptions(snapshot),
    ...detectMissingH1(snapshot),
    ...detectMissingImageAlt(snapshot),
  ];
}
