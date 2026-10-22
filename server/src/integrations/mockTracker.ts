import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../db/client";
import type { IssueTracker, TrackerIssueDraft, TrackerRecord } from "./tracker.interface";

interface MockRow {
  dedupe_key: string;
  tracker_id: string;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
}

export class MockTracker implements IssueTracker {
  constructor(private readonly db: SqliteDatabase) {}

  async findByDedupeKey(dedupeKey: string): Promise<TrackerRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM mock_tracker_issues WHERE dedupe_key = ?")
      .get(dedupeKey) as MockRow | undefined;
    return row ? { id: row.tracker_id, url: row.url, state: row.state } : null;
  }

  async createIssue(draft: TrackerIssueDraft): Promise<TrackerRecord> {
    const existing = await this.findByDedupeKey(draft.dedupeKey);
    if (existing) return existing;

    const trackerId = `mock-${createHash("sha256").update(draft.dedupeKey).digest("hex").slice(0, 16)}`;
    const url = `http://fixloop.local/mock/issues/${trackerId}`;
    const body = [
      draft.description,
      "",
      `Type: ${draft.type}`,
      `Severity: ${draft.severity}`,
      `Source page: ${draft.sourceUrl}`,
      `Problem URL: ${draft.badUrl}`,
      `Suggested fix: ${draft.suggestedFix}`,
      `FixLoop dedupe key: ${draft.dedupeKey}`,
    ].join("\n");

    this.db
      .prepare(
        `INSERT INTO mock_tracker_issues
          (dedupe_key, tracker_id, title, body, url, state, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(draft.dedupeKey, trackerId, draft.title, body, url, new Date().toISOString());

    const record = await this.findByDedupeKey(draft.dedupeKey);
    if (!record) throw new Error("Mock tracker could not persist the issue.");
    return record;
  }

  async closeIssue(issue: TrackerRecord): Promise<TrackerRecord> {
    const result = this.db
      .prepare(
        `UPDATE mock_tracker_issues SET state = 'closed', closed_at = COALESCE(closed_at, ?)
         WHERE tracker_id = ?`,
      )
      .run(new Date().toISOString(), issue.id);
    if (result.changes === 0) throw new Error(`Mock tracker issue not found: ${issue.id}`);
    return { ...issue, state: "closed" };
  }

  async reopenIssue(issue: TrackerRecord): Promise<TrackerRecord> {
    const result = this.db
      .prepare("UPDATE mock_tracker_issues SET state = 'open', closed_at = NULL WHERE tracker_id = ?")
      .run(issue.id);
    if (result.changes === 0) throw new Error(`Mock tracker issue not found: ${issue.id}`);
    return { ...issue, state: "open" };
  }
}
