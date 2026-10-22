import type {
  AuditEngine,
  CrawlPlan,
  CrawlSnapshot,
  DetectorFinding,
  NotCrawledPage,
  PlannedPage,
  Severity,
} from "../../../shared/types";
import type {
  EvidenceRepository,
  IssueRepository,
  PageRepository,
  LinkRepository,
  RunRepository,
} from "../db/repositories";
import { makeDedupeKey } from "../db/repositories/issues";
import { IssueDrafter } from "./issueDrafter";

export interface OrchestratorDependencies {
  runs: RunRepository;
  pages: PageRepository;
  links: LinkRepository;
  issues: IssueRepository;
  evidence: EvidenceRepository;
  engine: AuditEngine;
  drafter: IssueDrafter;
  maxPageLimit?: number;
}

export interface RunExecutionSummary {
  runId: string;
  crawledCount: number;
  plannedCount: number;
  notCrawledCount: number;
  proposedIssueCount: number;
  deduplicatedIssueCount: number;
}

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNotCrawled(items: NotCrawledPage[]): NotCrawledPage[] {
  const byUrl = new Map<string, NotCrawledPage>();
  for (const item of items) {
    const url = item.url?.trim();
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, { url, reason: item.reason || "Not selected by the crawl planner." });
  }
  return Array.from(byUrl.values());
}

function chooseSeverity(finding: DetectorFinding): Severity {
  if (finding.severity) return finding.severity;
  if (finding.type === "broken_link") {
    if (finding.statusCode == null) return "medium";
    if (finding.statusCode >= 500) return "high";
    return finding.statusCode >= 400 ? "high" : "medium";
  }
  if (finding.type === "redirect_chain") return "medium";
  if (finding.type === "missing_alt") return "low";
  if (finding.type === "missing_meta_description") return "low";
  return "medium";
}

function issueStatus(finding: DetectorFinding): "pending_approval" | "uncertain" {
  if (finding.outcome === "timeout") return "uncertain";
  if (
    finding.type === "broken_link" &&
    finding.statusCode == null &&
    finding.outcome !== "ok"
  ) {
    return "uncertain";
  }
  return "pending_approval";
}

function normalizeFinding(finding: DetectorFinding, siteUrl: string): DetectorFinding | null {
  const source = finding.sourceUrl?.trim();
  const target = finding.badUrl?.trim();
  if (!source || !target) return null;
  try {
    return {
      ...finding,
      sourceUrl: new URL(source, siteUrl).toString(),
      badUrl: new URL(target, source).toString(),
      redirectChain: finding.redirectChain ?? [],
      checkedAt: finding.checkedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export class AuditOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async executeRun(runId: string): Promise<RunExecutionSummary> {
    const run = this.deps.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (!run.permissionConfirmed) throw new Error("A confirmed crawl permission is required.");
    if (run.status === "completed") {
      return {
        runId,
        crawledCount: run.crawledCount,
        plannedCount: run.plan.length,
        notCrawledCount: run.notCrawled.length,
        proposedIssueCount: this.deps.issues.listByRun(runId).length,
        deduplicatedIssueCount: 0,
      };
    }

    this.deps.runs.setRunning(runId);
    try {
      const maxLimit = Math.min(this.deps.maxPageLimit ?? 200, 200);
      const pageLimit = Math.min(run.pageLimit, maxLimit);
      const rawPlan = await this.deps.engine.plan(run.siteUrl, pageLimit);
      const ranked = uniqueByUrl(rawPlan.pages ?? []);
      const selected = ranked.slice(0, pageLimit).map((page) => ({
        ...page,
        depth: Math.max(0, page.depth ?? 0),
        priority: Number.isFinite(page.priority) ? page.priority : 0,
        priorityReason: page.priorityReason || "Prioritised by the crawl planner.",
        status: "planned" as const,
      }));
      const overflow = ranked.slice(pageLimit).map((page) => ({
        url: page.url,
        reason: `Page limit reached (${pageLimit} pages).`,
      }));
      const plan: CrawlPlan = {
        pages: selected,
        notCrawled: uniqueNotCrawled([...(rawPlan.notCrawled ?? []), ...overflow]),
      };
      const candidateCount = Math.max(
        ranked.length + (rawPlan.notCrawled?.length ?? 0),
        plan.pages.length + plan.notCrawled.length,
      );

      this.deps.runs.savePlan(runId, plan.pages, plan.notCrawled, candidateCount);
      this.deps.pages.savePlan(runId, plan.pages, plan.notCrawled);

      const rawSnapshot = await this.deps.engine.crawl(plan, pageLimit);
      const crawledPages = uniqueByUrl(rawSnapshot.pages ?? []).filter((page) => page.crawled !== false);
      const acceptedPages = crawledPages.slice(0, pageLimit);
      const dropped = crawledPages.slice(pageLimit).map((page) => ({
        url: page.url,
        reason: `Page limit reached (${pageLimit} pages); this page was not persisted as crawled.`,
      }));
      const acceptedUrls = new Set(acceptedPages.map((page) => page.url));
      const skippedPlanned = plan.pages
        .filter((page) => !acceptedUrls.has(page.url))
        .map((page) => ({ url: page.url, reason: "The crawler did not return a completed page result." }));
      const finalPlan = plan.pages.map((page) => ({
        ...page,
        status: acceptedUrls.has(page.url) ? "crawled" as const : "not_crawled" as const,
      }));
      const actualNotCrawled = uniqueNotCrawled([
        ...plan.notCrawled,
        ...(rawSnapshot.notCrawled ?? []),
        ...dropped,
        ...skippedPlanned,
      ].filter((page) => !acceptedUrls.has(page.url)));
      const snapshot: CrawlSnapshot = {
        pages: acceptedPages,
        links: (rawSnapshot.links ?? []).filter((link) => acceptedPages.some((page) => page.url === link.sourceUrl)),
        notCrawled: actualNotCrawled,
      };

      this.deps.pages.saveCrawl(runId, snapshot.pages, plan.pages);
      this.deps.links.saveMany(runId, snapshot.links);

      const findings = await this.deps.engine.detect(snapshot);
      let newOrObserved = 0;
      let reused = 0;
      for (const rawFinding of findings) {
        const finding = normalizeFinding(rawFinding, run.siteUrl);
        if (!finding) continue;
        const dedupeKey = this.deps.issues.getByDedupeKey(
          makeDedupeKey(finding.sourceUrl, finding.badUrl, finding.type),
        );
        const draft = await this.deps.drafter.draft(finding);
        const issue = this.deps.issues.propose({
          runId,
          type: finding.type,
          severity: chooseSeverity(finding),
          status: issueStatus(finding),
          sourceUrl: finding.sourceUrl,
          badUrl: finding.badUrl,
          statusCode: finding.statusCode,
          redirectChain: finding.redirectChain,
          title: draft.title,
          description: draft.description,
          suggestedFix: draft.suggestedFix,
          checkedAt: finding.checkedAt,
        });
        if (dedupeKey) reused++;
        newOrObserved++;
        this.deps.evidence.record({
          issueId: issue.id,
          runId,
          kind: "detector",
          capturedAt: finding.checkedAt,
          payload: {
            sourcePage: finding.sourceUrl,
            badUrl: finding.badUrl,
            issueType: finding.type,
            statusCode: finding.statusCode ?? null,
            redirectChain: finding.redirectChain ?? [],
            checkedAt: finding.checkedAt,
            outcome: finding.outcome ?? "unknown",
            detectorEvidence: finding.evidence ?? {},
            draftGeneratedBy: draft.generatedBy,
          },
        });
      }

      this.deps.runs.savePlan(runId, finalPlan, actualNotCrawled, candidateCount);
      this.deps.pages.savePlan(runId, finalPlan, actualNotCrawled);
      const totalPages = Math.max(candidateCount, acceptedPages.length + actualNotCrawled.length);
      this.deps.runs.finish(runId, acceptedPages.length, totalPages);
      return {
        runId,
        crawledCount: acceptedPages.length,
        plannedCount: plan.pages.length,
        notCrawledCount: actualNotCrawled.length,
        proposedIssueCount: newOrObserved,
        deduplicatedIssueCount: reused,
      };
    } catch (error) {
      this.deps.runs.fail(runId, error);
      throw error;
    }
  }
}
