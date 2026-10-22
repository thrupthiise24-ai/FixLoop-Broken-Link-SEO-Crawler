import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type SqliteDatabase = Database.Database;

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

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(readFileSync(findSchemaFile(), "utf8"));
  return db;
}

export function closeDatabase(db: SqliteDatabase): void {
  if (db.open) db.close();
}
