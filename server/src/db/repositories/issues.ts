import { createHash, randomUUID } from "node:crypto";
import type {
  Issue,
  IssueRootCauseGroup,
  IssueStatus,
  IssueType,
  Severity,
} from "../../../../shared/types";
import type { SqliteDatabase } from "../client";

export interface ProposedIssueInput {
  runId: string;
  type: IssueType;
  severity: Severity;
  status: "pending_approval" | "uncertain";
  sourceUrl: string;
  badUrl: string;
  statusCode?: number | null;
  redirectChain?: string[];
  title: string;
  description: string;
  suggestedFix: string;
  checkedAt?: string;
}

type IssueRow = {
  id: string;
  dedupe_key: string;
  root_cause_key: string;
  type: IssueType;
  severity: Severity;
  status: IssueStatus;
  source_url: string;
  bad_url: string;
  status_code: number | null;
  redirect_chain_json: string;
  title: string;
  description: string;
  suggested_fix: string;
  tracker_id: string | null;
  tracker_url: string | null;
  tracker_state: Issue["trackerState"];
  approved_at: string | null;
  closed_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export function canonicalizeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return trimmed.replace(/#.*$/, "").replace(/\/$/, "");
  }
}

export function makeDedupeKey(sourceUrl: string, badUrl: string, type: IssueType): string {
  const source = canonicalizeUrl(sourceUrl);
  const target = canonicalizeUrl(badUrl);
  return createHash("sha1").update(`${source}\n${target}\n${type}`).digest("hex");
}

export function makeRootCauseKey(badUrl: string, type: IssueType): string {
  return createHash("sha1")
    .update(`${type}\n${canonicalizeUrl(badUrl)}`)
    .digest("hex");
}

function parseChain(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: IssueRow | undefined): Issue | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    rootCauseKey: row.root_cause_key,
    type: row.type,
    severity: row.severity,
    status: row.status,
    sourceUrl: row.source_url,
    badUrl: row.bad_url,
    statusCode: row.status_code,
    redirectChain: parseChain(row.redirect_chain_json),
    title: row.title,
    description: row.description,
    suggestedFix: row.suggested_fix,
    trackerId: row.tracker_id,
    trackerUrl: row.tracker_url,
    trackerState: row.tracker_state,
    approvedAt: row.approved_at,
    closedAt: row.closed_at,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const severityRank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function groupedStatus(statuses: IssueStatus[]): IssueStatus {
  if (statuses.includes("pending_approval")) return "pending_approval";
  if (statuses.includes("still_failing")) return "still_failing";
  if (statuses.includes("uncertain")) return "uncertain";
  if (statuses.every((status) => status === "fixed" || status === "rejected")) {
    return statuses.includes("fixed") ? "fixed" : "rejected";
  }
  if (statuses.includes("open")) return "open";
  return statuses[0] ?? "pending_approval";
}

export class IssueRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string): Issue | undefined {
    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as
      | IssueRow
      | undefined;
    return fromRow(row);
  }

  getByDedupeKey(dedupeKey: string): Issue | undefined {
    const row = this.db
      .prepare("SELECT * FROM issues WHERE dedupe_key = ?")
      .get(dedupeKey) as IssueRow | undefined;
    return fromRow(row);
  }

  /**
   * Atomically creates (or reuses) a globally deduped issue, and associates it
   * with this run. The original brief's key is sha1(source + target + type).
   */
  propose(input: ProposedIssueInput): Issue {
    const dedupeKey = makeDedupeKey(input.sourceUrl, input.badUrl, input.type);
    const rootCauseKey = makeRootCauseKey(input.badUrl, input.type);
    const now = input.checkedAt ?? new Date().toISOString();
    const id = randomUUID();
    const sourcePage = this.db
      .prepare("SELECT id FROM pages WHERE run_id = ? AND url = ?")
      .get(input.runId, input.sourceUrl) as { id: string } | undefined;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO issues
            (id, dedupe_key, root_cause_key, type, severity, status, source_page_id,
             source_url, bad_url, status_code, redirect_chain_json, title, description,
             suggested_fix, last_checked_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(dedupe_key) DO NOTHING`,
        )
        .run(
          id,
          dedupeKey,
          rootCauseKey,
          input.type,
          input.severity,
          input.status,
          sourcePage?.id ?? null,
          input.sourceUrl,
          input.badUrl,
          input.statusCode ?? null,
          JSON.stringify(input.redirectChain ?? []),
          input.title,
          input.description,
          input.suggestedFix,
          now,
          now,
          now,
        );

      const existing = this.getByDedupeKey(dedupeKey);
      if (!existing) throw new Error("Could not persist the proposed issue.");

      this.db
        .prepare(
          `INSERT INTO issue_runs (issue_id, run_id, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(issue_id, run_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        )
        .run(existing.id, input.runId, now, now);

      // A previous timeout can be upgraded to a concrete human-review item.
      if (existing.status === "uncertain" && input.status === "pending_approval") {
        this.db
          .prepare(
            `UPDATE issues SET status = 'pending_approval', severity = ?, status_code = ?,
               redirect_chain_json = ?, last_checked_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.severity,
            input.statusCode ?? null,
            JSON.stringify(input.redirectChain ?? []),
            now,
            now,
            existing.id,
          );
      } else if (existing.status === "fixed" && input.status === "pending_approval") {
        this.db
          .prepare(
            `UPDATE issues SET status = 'pending_approval', severity = ?, status_code = ?,
               redirect_chain_json = ?, title = ?, description = ?, suggested_fix = ?,
               approved_at = NULL, closed_at = NULL, last_checked_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.severity,
            input.statusCode ?? null,
            JSON.stringify(input.redirectChain ?? []),
            input.title,
            input.description,
            input.suggestedFix,
            now,
            now,
            existing.id,
          );
        this.insertEvent(existing.id, "fixed", "pending_approval", "issue_regressed", "system", { runId: input.runId }, now);
      } else {
        this.db
          .prepare(
            `UPDATE issues SET status_code = ?, redirect_chain_json = ?, last_checked_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(input.statusCode ?? null, JSON.stringify(input.redirectChain ?? []), now, now, existing.id);
      }
    });

    transaction();
    return this.getByDedupeKey(dedupeKey)!;
  }

  listByRun(runId: string): Issue[] {
    const rows = this.db
      .prepare(
        `SELECT i.* FROM issues i
         INNER JOIN issue_runs ir ON ir.issue_id = i.id
         WHERE ir.run_id = ?
         ORDER BY
           CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           i.source_url ASC, i.created_at ASC`,
      )
      .all(runId) as IssueRow[];
    return rows.map((row) => fromRow(row)!);
  }

  listRootCauseGroups(runId: string): IssueRootCauseGroup[] {
    const groups = new Map<string, Issue[]>();
    for (const issue of this.listByRun(runId)) {
      const items = groups.get(issue.rootCauseKey) ?? [];
      items.push(issue);
      groups.set(issue.rootCauseKey, items);
    }

    return Array.from(groups.entries()).map(([rootCauseKey, issues]) => {
      const first = issues[0];
      const sources = Array.from(new Set(issues.map((issue) => issue.sourceUrl))).sort();
      const severity = issues.reduce(
        (best, item) => severityRank[item.severity] > severityRank[best] ? item.severity : best,
        first.severity,
      );
      return {
        rootCauseKey,
        type: first.type,
        badUrl: first.badUrl,
        severity,
        status: groupedStatus(issues.map((issue) => issue.status)),
        issueIds: issues.map((issue) => issue.id),
        sourcePages: sources,
        sourceCount: sources.length,
      };
    });
  }

  markApproved(id: string, actor = "human"): Issue {
    const issue = this.get(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    if (issue.approvedAt) {
      if (issue.status === "pending_approval") return issue;
      throw new Error(`Issue ${id} has already been approved or filed.`);
    }

    const canApprove = issue.status === "pending_approval" ||
      (issue.status === "still_failing" && !issue.trackerId);
    if (!canApprove) {
      throw new Error(`Issue ${id} is not awaiting approval (status: ${issue.status}).`);
    }

    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE issues SET status = 'pending_approval', approved_at = ?, updated_at = ?
           WHERE id = ? AND status = ? AND approved_at IS NULL`,
        )
        .run(now, now, id, issue.status);
      if (result.changes === 0) throw new Error(`Issue ${id} changed while approval was being recorded.`);
      this.insertEvent(id, issue.status, "pending_approval", "human_approved", actor, {}, now);
    });
    transaction();
    return this.get(id)!;
  }

  markFiled(id: string, tracker: { id: string; url: string }): Issue {
    const issue = this.get(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    if (issue.status === "open" && issue.trackerId) return issue;
    if (issue.status !== "pending_approval" || !issue.approvedAt) {
      throw new Error(`Issue ${id} must be approved before it can be filed.`);
    }
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE issues SET status = 'open', tracker_id = ?, tracker_url = ?, tracker_state = 'open',
         updated_at = ? WHERE id = ? AND status = 'pending_approval' AND approved_at IS NOT NULL`,
      )
      .run(tracker.id, tracker.url, now, id);
    if (result.changes > 0) this.insertEvent(id, issue.status, "open", "issue_filed", "system", { tracker }, now);
    return this.get(id)!;
  }

  markRejected(id: string, actor = "human"): Issue {
    const issue = this.get(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    if (issue.status === "rejected") return issue;

    const canReject = issue.status === "pending_approval" ||
      ((issue.status === "still_failing" || issue.status === "uncertain") && !issue.trackerId);
    if (!canReject || issue.approvedAt) {
      throw new Error(`Issue ${id} cannot be rejected after approval or filing.`);
    }

    const now = new Date().toISOString();
    const result = this.db
      .prepare("UPDATE issues SET status = 'rejected', updated_at = ? WHERE id = ? AND status = ? AND approved_at IS NULL")
      .run(now, id, issue.status);
    if (result.changes > 0) this.insertEvent(id, issue.status, "rejected", "human_rejected", actor, {}, now);
    return this.get(id)!;
  }

  markRechecked(
    id: string,
    status: "fixed" | "still_failing" | "uncertain",
    details: { statusCode?: number | null; redirectChain?: string[]; trackerState?: Issue["trackerState"] },
  ): Issue {
    const issue = this.get(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    const now = new Date().toISOString();
    const closedAt = status === "fixed" &&
      (details.trackerState === "closed" || details.trackerState === "not_filed")
      ? now
      : null;
    this.db
      .prepare(
        `UPDATE issues SET status = ?, status_code = ?, redirect_chain_json = ?,
           last_checked_at = ?, closed_at = ?, tracker_state = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        status,
        details.statusCode === undefined ? issue.statusCode : details.statusCode,
        JSON.stringify(details.redirectChain === undefined ? issue.redirectChain : details.redirectChain),
        now,
        closedAt,
        details.trackerState ?? issue.trackerState,
        now,
        id,
      );
    this.insertEvent(id, issue.status, status, "rechecked", "system", details, now);
    return this.get(id)!;
  }

  private insertEvent(
    issueId: string,
    fromStatus: string | null,
    toStatus: string,
    action: string,
    actor: string,
    details: Record<string, unknown>,
    createdAt = new Date().toISOString(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO issue_events
          (id, issue_id, from_status, to_status, action, actor, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), issueId, fromStatus, toStatus, action, actor, JSON.stringify(details), createdAt);
  }
}
