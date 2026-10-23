import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SqliteDatabase {
  prepare(sql: string): {
    run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  };
  exec(sql: string): void;
  pragma?(pragma: string): any;
  transaction?(fn: (...args: any[]) => any): (...args: any[]) => any;
  close(): void;
  open?: boolean;
}

function findSchemaFile(): string {
  const candidates = [
    join(__dirname, "schema.sql"),
    join(__dirname, "../../../../src/db/schema.sql"),
    join(__dirname, "../../src/db/schema.sql"),
    join(process.cwd(), "server/src/db/schema.sql"),
    join(process.cwd(), "src/db/schema.sql"),
  ];

  const path = candidates.find(existsSync);
  if (!path) {
    throw new Error(`Could not locate schema.sql. Looked in: ${candidates.join(", ")}`);
  }
  return path;
}

export function openDatabase(filename: string): SqliteDatabase {
  if (filename !== ":memory:") {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }

  // 1. Try better-sqlite3 if available
  try {
    const BetterSqlite = require("better-sqlite3");
    if (BetterSqlite) {
      const db = new BetterSqlite(filename);
      db.pragma("foreign_keys = ON");
      if (filename !== ":memory:") db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.exec(readFileSync(findSchemaFile(), "utf8"));
      return db;
    }
  } catch {
    // Fall back to built-in node:sqlite
  }

  // 2. Fall back to Node.js native node:sqlite (zero native compilation required)
  const { DatabaseSync } = require("node:sqlite");
  const nativeDb = new DatabaseSync(filename);
  nativeDb.exec("PRAGMA foreign_keys = ON;");
  if (filename !== ":memory:") nativeDb.exec("PRAGMA journal_mode = WAL;");
  nativeDb.exec("PRAGMA busy_timeout = 5000;");
  nativeDb.exec(readFileSync(findSchemaFile(), "utf8"));

  const adapter: SqliteDatabase = {
    prepare(sql: string) {
      const stmt = nativeDb.prepare(sql);
      return {
        run(...params: any[]) {
          return stmt.run(...params);
        },
        get(...params: any[]) {
          return stmt.get(...params);
        },
        all(...params: any[]) {
          return stmt.all(...params);
        },
      };
    },
    exec(sql: string) {
      nativeDb.exec(sql);
    },
    pragma(pragmaStr: string) {
      return nativeDb.exec(`PRAGMA ${pragmaStr};`);
    },
    transaction(fn: (...args: any[]) => any) {
      return (...args: any[]) => {
        nativeDb.exec("SAVEPOINT fixloop_tx;");
        try {
          const res = fn(...args);
          nativeDb.exec("RELEASE SAVEPOINT fixloop_tx;");
          return res;
        } catch (err) {
          nativeDb.exec("ROLLBACK TO SAVEPOINT fixloop_tx;");
          throw err;
        }
      };
    },
    close() {
      nativeDb.close();
    },
    get open() {
      return true;
    },
  };

  return adapter;
}

export function closeDatabase(db: SqliteDatabase): void {
  try {
    db.close();
  } catch {}
}
