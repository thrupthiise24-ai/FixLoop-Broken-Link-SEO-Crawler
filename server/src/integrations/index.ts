import type { ServerConfig } from "../config";
import type { SqliteDatabase } from "../db/client";
import { GitHubTracker } from "./githubTracker";
import { MockTracker } from "./mockTracker";
import type { IssueTracker } from "./tracker.interface";

export function createTracker(config: ServerConfig, db: SqliteDatabase): IssueTracker {
  if (config.githubToken && config.githubRepository) {
    return new GitHubTracker({
      token: config.githubToken,
      repository: config.githubRepository,
    });
  }
  return new MockTracker(db);
}

export type { IssueTracker, TrackerIssueDraft, TrackerRecord } from "./tracker.interface";
