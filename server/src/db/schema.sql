PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  site_url TEXT NOT NULL,
  page_limit INTEGER NOT NULL CHECK (page_limit BETWEEN 1 AND 200),
  permission_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (permission_confirmed = 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  crawled_count INTEGER NOT NULL DEFAULT 0 CHECK (crawled_count >= 0),
  total_pages INTEGER NOT NULL DEFAULT 0 CHECK (total_pages >= 0),
  plan_json TEXT NOT NULL DEFAULT '[]',
  not_crawled_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
  priority REAL NOT NULL DEFAULT 0,
  priority_reason TEXT NOT NULL DEFAULT '',
  status_code INTEGER,
  title TEXT,
  crawled_at TEXT,
  crawled INTEGER NOT NULL DEFAULT 0 CHECK (crawled IN (0, 1)),
  UNIQUE (run_id, url)
);

CREATE INDEX IF NOT EXISTS idx_pages_run_crawled ON pages(run_id, crawled);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  status_code INTEGER,
  redirect_chain_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'unknown' CHECK (outcome IN ('ok', 'error', 'timeout', 'unknown')),
  error TEXT,
  UNIQUE (run_id, source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_links_run_target ON links(run_id, target_url);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  root_cause_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'broken_link', 'redirect_chain', 'missing_title', 'duplicate_title',
    'missing_meta_description', 'missing_h1', 'missing_alt'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN (
    'pending_approval', 'open', 'fixed', 'still_failing', 'rejected', 'uncertain'
  )),
  source_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  bad_url TEXT NOT NULL,
  status_code INTEGER,
  redirect_chain_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_fix TEXT NOT NULL,
  tracker_id TEXT,
  tracker_url TEXT,
  tracker_state TEXT NOT NULL DEFAULT 'not_filed' CHECK (tracker_state IN (
    'not_filed', 'open', 'closed', 'close_failed'
  )),
  approved_at TEXT,
  closed_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_root_cause ON issues(root_cause_key);

-- An issue is globally deduped, but can be observed in multiple runs.
CREATE TABLE IF NOT EXISTS issue_runs (
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_runs_run ON issue_runs(run_id);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE (issue_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_evidence_issue_time ON evidence(issue_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS issue_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_events_issue_time ON issue_events(issue_id, created_at DESC);

-- Durable mock tracker makes approval/filer retries idempotent across restarts.
CREATE TABLE IF NOT EXISTS mock_tracker_issues (
  dedupe_key TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_case TEXT NOT NULL CHECK (test_case IN ('TC1', 'TC2', 'TC3', 'TC4')),
  input TEXT NOT NULL,
  expected TEXT NOT NULL,
  actual TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_runs_case_time ON test_runs(test_case, created_at DESC);
