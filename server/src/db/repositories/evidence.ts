import { createHash, randomUUID } from "node:crypto";
import type { Evidence } from "../../../../shared/types";
import type { SqliteDatabase } from "../client";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export class EvidenceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  record(input: {
    issueId: string;
    runId?: string | null;
    kind: string;
    payload: Record<string, unknown>;
    capturedAt?: string;
  }): Evidence {
    const capturedAt = input.capturedAt ?? new Date().toISOString();
    const payloadJson = stableJson(input.payload);
    const fingerprint = createHash("sha256")
      .update(`${input.runId ?? ""}\n${input.kind}\n${payloadJson}`)
      .digest("hex");
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO evidence (id, issue_id, run_id, kind, payload_json, fingerprint, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(issue_id, fingerprint) DO NOTHING`,
      )
      .run(id, input.issueId, input.runId ?? null, input.kind, payloadJson, fingerprint, capturedAt);

    const row = this.db
      .prepare("SELECT * FROM evidence WHERE issue_id = ? AND fingerprint = ?")
      .get(input.issueId, fingerprint) as
      | {
          id: string;
          issue_id: string;
          run_id: string | null;
          kind: string;
          payload_json: string;
          captured_at: string;
        }
      | undefined;
    if (!row) throw new Error("Could not persist issue evidence.");
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      // Keep the evidence record available even if a future schema is malformed.
    }
    return {
      id: row.id,
      issueId: row.issue_id,
      runId: row.run_id,
      kind: row.kind,
      payload,
      capturedAt: row.captured_at,
    };
  }

  listForIssue(issueId: string): Evidence[] {
    const rows = this.db
      .prepare("SELECT * FROM evidence WHERE issue_id = ? ORDER BY captured_at DESC, id DESC")
      .all(issueId) as Array<{
      id: string;
      issue_id: string;
      run_id: string | null;
      kind: string;
      payload_json: string;
      captured_at: string;
    }>;
    return rows.map((row) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        // Ignore malformed JSON and retain the metadata.
      }
      return {
        id: row.id,
        issueId: row.issue_id,
        runId: row.run_id,
        kind: row.kind,
        payload,
        capturedAt: row.captured_at,
      };
    });
  }
}
