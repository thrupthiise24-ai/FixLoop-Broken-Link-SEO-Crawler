import type { CrawlSnapshot, DetectorFinding } from "../../../shared/types";

export function detectBrokenLinks(snapshot: CrawlSnapshot): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  for (const link of snapshot.links) {
    if (link.internal === false) continue;
    if (link.statusCode != null && link.statusCode >= 400) {
      findings.push({
        type: "broken_link",
        sourceUrl: link.sourceUrl,
        badUrl: link.targetUrl,
        statusCode: link.statusCode,
        redirectChain: link.redirectChain ?? [],
        outcome: "error",
        checkedAt: link.checkedAt,
        severity: link.statusCode >= 500 ? "high" : "high",
        evidence: {
          failure: `HTTP ${link.statusCode}`,
          internal: link.internal ?? true,
        },
      });
      continue;
    }
    if (link.statusCode == null && (link.outcome === "timeout" || (link.outcome === "error" && link.error))) {
      findings.push({
        type: "broken_link",
        sourceUrl: link.sourceUrl,
        badUrl: link.targetUrl,
        outcome: link.outcome,
        checkedAt: link.checkedAt,
        evidence: { uncertainReason: link.error ?? "No HTTP response was received." },
        message: "The link check did not produce an HTTP response; retry before calling it broken.",
      });
    }
  }
  return findings;
}
