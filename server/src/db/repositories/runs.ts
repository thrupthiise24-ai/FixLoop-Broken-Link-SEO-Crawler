import { randomUUID } from "node:crypto";
import type { NotCrawledPage, PlannedPage, Run, RunStatus } from "../../../../shared/types";
import type { SqliteDatabase } from "../client";

type RunRow = {
  id: string;
  site_url: string;
  page_limit: number;
  permission_confirmed: number;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  crawled_count: number;
  total_pages: number;
  plan_json: string;
  not_crawled_json: string;
  error: string | null;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fromRow(row: RunRow | undefined): Run | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    siteUrl: row.site_url,
    pageLimit: row.page_limit,
    permissionConfirmed: row.permission_confirmed === 1,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    crawledCount: row.crawled_count,
    totalPages: row.total_pages,
    plan: parseJson<PlannedPage[]>(row.plan_json, []),
    notCrawled: parseJson<NotCrawledPage[]>(row.not_crawled_json, []),
    error: row.error,
  };
}

export class RunRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: {
    siteUrl: string;
    pageLimit: number;
    permissionConfirmed: true;
  }): Run {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs (id, site_url, page_limit, permission_confirmed, status, started_at)
         VALUES (?, ?, ?, 1, 'queued', ?)`,
      )
      .run(id, input.siteUrl, input.pageLimit, startedAt);
    return this.get(id)!;
  }

  get(id: string): Run | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      | RunRow
      | undefined;
    return fromRow(row);
  }

  setRunning(id: string): void {
    const result = this.db
      .prepare("UPDATE runs SET status = 'running', error = NULL WHERE id = ?")
      .run(id);
    if (result.changes === 0) throw new Error(`Run not found: ${id}`);
  }

  savePlan(
    id: string,
    plan: PlannedPage[],
    notCrawled: NotCrawledPage[],
    totalPages: number,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE runs
         SET plan_json = ?, not_crawled_json = ?, total_pages = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(plan), JSON.stringify(notCrawled), totalPages, id);
    if (result.changes === 0) throw new Error(`Run not found: ${id}`);
  }

  finish(id: string, crawledCount: number, totalPages: number): void {
    const result = this.db
      .prepare(
        `UPDATE runs
         SET status = 'completed', finished_at = ?, crawled_count = ?, total_pages = ?, error = NULL
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), crawledCount, totalPages, id);
    if (result.changes === 0) throw new Error(`Run not found: ${id}`);
  }

  fail(id: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.db
      .prepare(
        `UPDATE runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), message.slice(0, 2000), id);
  }
}
