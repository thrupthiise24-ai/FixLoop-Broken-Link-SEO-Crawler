import { randomUUID } from "node:crypto";
import type { CrawledLink } from "../../../../shared/types";
import type { SqliteDatabase } from "../client";
import type { PageRepository } from "./pages";

export interface StoredLink extends CrawledLink {
  id: string;
  runId: string;
}

export class LinkRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly pages: PageRepository,
  ) {}

  saveMany(runId: string, links: CrawledLink[]): void {
    const pageIds = this.pages.listIdByUrl(runId);
    const now = new Date().toISOString();
    const save = this.db.transaction((items: CrawledLink[]) => {
      for (const link of items) {
        this.db
          .prepare(
            `INSERT INTO links
              (id, run_id, source_page_id, source_url, target_url, status_code,
               redirect_chain_json, checked_at, outcome, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id, source_url, target_url) DO UPDATE SET
               source_page_id = excluded.source_page_id,
               status_code = excluded.status_code,
               redirect_chain_json = excluded.redirect_chain_json,
               checked_at = excluded.checked_at,
               outcome = excluded.outcome,
               error = excluded.error`,
          )
          .run(
            randomUUID(),
            runId,
            pageIds.get(link.sourceUrl) ?? null,
            link.sourceUrl,
            link.targetUrl,
            link.statusCode ?? null,
            JSON.stringify(link.redirectChain ?? []),
            link.checkedAt ?? now,
            link.outcome ?? "unknown",
            link.error ?? null,
          );
      }
    });
    save(links);
  }

  listByRun(runId: string): StoredLink[] {
    const rows = this.db
      .prepare("SELECT * FROM links WHERE run_id = ? ORDER BY source_url, target_url")
      .all(runId) as Array<{
      id: string;
      run_id: string;
      source_url: string;
      target_url: string;
      status_code: number | null;
      redirect_chain_json: string;
      checked_at: string;
      outcome: StoredLink["outcome"];
      error: string | null;
    }>;
    return rows.map((row) => {
      let chain: string[] = [];
      try {
        chain = JSON.parse(row.redirect_chain_json) as string[];
      } catch {
        // Treat malformed persisted JSON as empty evidence, not a server error.
      }
      return {
        id: row.id,
        runId: row.run_id,
        sourceUrl: row.source_url,
        targetUrl: row.target_url,
        statusCode: row.status_code,
        redirectChain: chain,
        checkedAt: row.checked_at,
        outcome: row.outcome,
        error: row.error ?? undefined,
      };
    });
  }
}
