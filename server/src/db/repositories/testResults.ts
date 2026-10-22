import type { TestCaseRecord } from "../../../../shared/types";
import type { SqliteDatabase } from "../client";

export interface NewTestCaseRecord {
  testCase: TestCaseRecord["testCase"];
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
  evidence?: string[];
  notes?: string | null;
}

export class TestResultsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  record(input: NewTestCaseRecord): TestCaseRecord {
    const result = this.db
      .prepare(
        `INSERT INTO test_runs
          (test_case, input, expected, actual, passed, evidence_json, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.testCase,
        input.input,
        input.expected,
        input.actual,
        input.passed ? 1 : 0,
        JSON.stringify(input.evidence ?? []),
        input.notes ?? null,
        new Date().toISOString(),
      );
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): TestCaseRecord | undefined {
    const row = this.db.prepare("SELECT * FROM test_runs WHERE id = ?").get(id) as
      | {
          id: number;
          test_case: TestCaseRecord["testCase"];
          input: string;
          expected: string;
          actual: string;
          passed: number;
          evidence_json: string;
          notes: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    let evidence: string[] = [];
    try {
      evidence = JSON.parse(row.evidence_json) as string[];
    } catch {
      // Corrupt evidence should not make the test-result endpoint unavailable.
    }
    return {
      id: row.id,
      testCase: row.test_case,
      input: row.input,
      expected: row.expected,
      actual: row.actual,
      passed: row.passed === 1,
      evidence,
      notes: row.notes,
      createdAt: row.created_at,
    };
  }

  listLatest(): TestCaseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM test_runs t
         INNER JOIN (
           SELECT test_case, MAX(id) AS latest_id FROM test_runs GROUP BY test_case
         ) latest ON latest.latest_id = t.id
         ORDER BY t.test_case`,
      )
      .all() as Array<{
      id: number;
      test_case: TestCaseRecord["testCase"];
      input: string;
      expected: string;
      actual: string;
      passed: number;
      evidence_json: string;
      notes: string | null;
      created_at: string;
    }>;
    return rows.map((row) => {
      let evidence: string[] = [];
      try {
        evidence = JSON.parse(row.evidence_json) as string[];
      } catch {
        // Keep the latest row visible even if its evidence JSON is damaged.
      }
      return {
        id: row.id,
        testCase: row.test_case,
        input: row.input,
        expected: row.expected,
        actual: row.actual,
        passed: row.passed === 1,
        evidence,
        notes: row.notes,
        createdAt: row.created_at,
      };
    });
  }
}
