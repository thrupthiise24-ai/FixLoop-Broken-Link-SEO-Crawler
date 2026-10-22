import type { IssueTracker, TrackerIssueDraft, TrackerRecord } from "./tracker.interface";

interface GitHubTrackerConfig {
  token: string;
  repository: string;
  apiBaseUrl?: string;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  state: "open" | "closed";
  body?: string | null;
  title: string;
}

export class GitHubTracker implements IssueTracker {
  private readonly owner: string;
  private readonly repo: string;
  private readonly apiBaseUrl: string;

  constructor(private readonly config: GitHubTrackerConfig) {
    const [owner, repo, extra] = config.repository.split("/");
    if (!owner || !repo || extra) {
      throw new Error("GITHUB_REPOSITORY must use the owner/repository format.");
    }
    this.owner = owner;
    this.repo = repo;
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  async findByDedupeKey(dedupeKey: string): Promise<TrackerRecord | null> {
    const marker = `FixLoop dedupe key: ${dedupeKey}`;
    const query = `repo:${this.owner}/${this.repo} in:body ${dedupeKey}`;
    const url = `${this.apiBaseUrl}/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
    const result = await this.request<{ items?: GitHubIssue[] }>(url);
    const match = result.items?.find((item) => (item.body ?? "").includes(marker));
    return match ? this.toRecord(match) : null;
  }

  async createIssue(draft: TrackerIssueDraft): Promise<TrackerRecord> {
    const found = await this.findByDedupeKey(draft.dedupeKey);
    if (found) return found;

    const body = [
      draft.description,
      "",
      `**Type:** ${draft.type}`,
      `**Severity:** ${draft.severity}`,
      `**Source page:** ${draft.sourceUrl}`,
      `**Problem URL:** ${draft.badUrl}`,
      `**Suggested fix:** ${draft.suggestedFix}`,
      "",
      `FixLoop dedupe key: ${draft.dedupeKey}`,
      "",
      "Filed only after a human approved this proposed issue in FixLoop.",
    ].join("\n");

    const issue = await this.request<GitHubIssue>(
      `${this.apiBaseUrl}/repos/${this.owner}/${this.repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify({ title: draft.title, body }),
      },
    );
    return this.toRecord(issue);
  }

  async closeIssue(issue: TrackerRecord): Promise<TrackerRecord> {
    const number = Number(issue.id);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`Cannot close GitHub issue with id ${issue.id}.`);
    }
    const closed = await this.request<GitHubIssue>(
      `${this.apiBaseUrl}/repos/${this.owner}/${this.repo}/issues/${number}`,
      { method: "PATCH", body: JSON.stringify({ state: "closed" }) },
    );
    return this.toRecord(closed);
  }

  async reopenIssue(issue: TrackerRecord): Promise<TrackerRecord> {
    const number = Number(issue.id);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`Cannot reopen GitHub issue with id ${issue.id}.`);
    }
    const reopened = await this.request<GitHubIssue>(
      `${this.apiBaseUrl}/repos/${this.owner}/${this.repo}/issues/${number}`,
      { method: "PATCH", body: JSON.stringify({ state: "open" }) },
    );
    return this.toRecord(reopened);
  }

  private toRecord(issue: GitHubIssue): TrackerRecord {
    return {
      id: String(issue.number),
      url: issue.html_url,
      state: issue.state,
    };
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const raw = await response.text();
      let data: unknown = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { message: raw };
      }
      if (!response.ok) {
        const message = data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : `GitHub API returned HTTP ${response.status}`;
        throw new Error(message);
      }
      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
