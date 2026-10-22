import { randomUUID } from "node:crypto";
import type { CrawlPage, NotCrawledPage, PlannedPage } from "../../../../shared/types";
import type { SqliteDatabase } from "../client";

export interface StoredPage extends CrawlPage {
  id: string;
  runId: string;
  priority: number;
  priorityReason: string;
  crawled: boolean;
}

export class PageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /** Save ranked pages before the crawl so the UI can show the agent's plan. */
  savePlan(runId: string, plan: PlannedPage[], notCrawled: NotCrawledPage[] = []): void {
    const save = this.db.transaction((input: { plan: PlannedPage[]; notCrawled: NotCrawledPage[] }) => {
      const plannedUrls = new Set(input.plan.map((page) => page.url));
      for (const page of input.plan) {
        this.db
          .prepare(
            `INSERT INTO pages
              (id, run_id, url, depth, priority, priority_reason, crawled)
             VALUES (?, ?, ?, ?, ?, ?, 0)
             ON CONFLICT(run_id, url) DO UPDATE SET
               depth = excluded.depth,
               priority = excluded.priority,
               priority_reason = excluded.priority_reason`,
          )
          .run(
            randomUUID(),
            runId,
            page.url,
            Math.max(0, page.depth ?? 0),
            page.priority ?? 0,
            page.priorityReason ?? "",
          );
      }
      for (const page of input.notCrawled) {
        if (!page.url || plannedUrls.has(page.url)) continue;
        this.db
          .prepare(
            `INSERT INTO pages (id, run_id, url, depth, priority, priority_reason, crawled)
             VALUES (?, ?, ?, 0, 0, ?, 0)
             ON CONFLICT(run_id, url) DO UPDATE SET priority_reason = excluded.priority_reason`,
          )
          .run(randomUUID(), runId, page.url, page.reason);
      }
    });
    save({ plan, notCrawled });
  }

  saveCrawl(runId: string, pages: CrawlPage[], plan: PlannedPage[] = []): void {
    const planByUrl = new Map(plan.map((item) => [item.url, item]));
    const now = new Date().toISOString();
    const save = this.db.transaction((items: CrawlPage[]) => {
      for (const page of items) {
        const planned = planByUrl.get(page.url);
        this.db
          .prepare(
            `INSERT INTO pages
              (id, run_id, url, depth, priority, priority_reason, status_code, title, crawled_at, crawled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id, url) DO UPDATE SET
               depth = excluded.depth,
               priority = excluded.priority,
               priority_reason = excluded.priority_reason,
               status_code = excluded.status_code,
               title = excluded.title,
               crawled_at = excluded.crawled_at,
               crawled = excluded.crawled`,
          )
          .run(
            randomUUID(),
            runId,
            page.url,
            Math.max(0, page.depth ?? planned?.depth ?? 0),
            page.priority ?? planned?.priority ?? 0,
            page.priorityReason ?? planned?.priorityReason ?? "",
            page.statusCode ?? null,
            page.title ?? null,
            page.crawledAt ?? now,
            page.crawled === false ? 0 : 1,
          );
      }
    });
    save(pages);
  }

  listIdByUrl(runId: string): Map<string, string> {
    const rows = this.db
      .prepare("SELECT id, url FROM pages WHERE run_id = ?")
      .all(runId) as Array<{ id: string; url: string }>;
    return new Map(rows.map((row) => [row.url, row.id]));
  }

  listByRun(runId: string): StoredPage[] {
    const rows = this.db
      .prepare("SELECT * FROM pages WHERE run_id = ? ORDER BY priority DESC, depth ASC, url ASC")
      .all(runId) as Array<{
      id: string;
      run_id: string;
      url: string;
      depth: number;
      priority: number;
      priority_reason: string;
      status_code: number | null;
      title: string | null;
      crawled_at: string | null;
      crawled: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      url: row.url,
      depth: row.depth,
      priority: row.priority,
      priorityReason: row.priority_reason,
      statusCode: row.status_code,
      title: row.title,
      crawledAt: row.crawled_at ?? undefined,
      crawled: row.crawled === 1,
    }));
  }
}
