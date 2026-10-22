# Member B — Agent, data, and integrations

## Implemented

- SQLite schema and repositories for runs, pages, links, issues, evidence, issue events, mock-tracker records, and test results.
- Orchestrator that stores the ranked plan, enforces the page cap again, persists observations, and creates evidence-backed proposed issues.
- SHA-1 issue dedupe in the brief's form `sha1(source_page + newline + bad_url + newline + issue_type)`, enforced by a unique index. `issue_runs` lets a deduped issue appear in later audits without creating a duplicate tracker issue.
- Root-cause groups that aggregate repeated target problems and list every affected source page.
- Human approval/rejection endpoints. A crawl can only propose; filing is called only through `POST /api/issues/:id/approve`.
- Persistent mock tracker by default and optional GitHub Issues integration, both keyed by the dedupe marker.
- Rechecks that become `fixed`, `still_failing`, or `uncertain`. Source pages are refreshed with GET; target links are probed with HEAD (GET fallback for 405/501, with the body discarded). A filed tracker issue is closed only after the recheck verifies the issue is gone.
- A later audit can reopen a previously fixed issue as `pending_approval`; a fresh human approval reopens the same tracker issue by its dedupe key instead of creating a duplicate.
- Optional Claude issue drafts with deterministic template fallback.
- Working HTTP crawler/planner/parser/detectors and a generated demo site, wired into the same server under `/demo`.
- API persistence for official TC1–TC4 results and a command-line runner that writes evidence JSON to `docs/evidence/`.

## Safety and scope

- The run endpoint requires `permission_confirmed: true`.
- The crawler obeys `robots.txt`, identifies itself as `FixLoopBot`, applies a per-origin rate limit and follows redirects manually.
- By default it follows same-origin links within the requested path scope; external targets are recorded as unchecked rather than fetched.
- A timeout or connection failure is stored as uncertain, not treated as a confirmed broken link.
- Issue filing requires a human approval request. The default mock tracker is safe for local tests; configure GitHub credentials only when ready.

## API routes

- `POST /api/runs` — `{ site_url, page_limit, permission_confirmed: true }`; returns a run ID.
- `GET /api/runs/:id` — run state, plan, crawl counts, and not-crawled reasons.
- `GET /api/runs/:id/issues` — issues grouped by source-page-capable fields, root-cause groups, and evidence.
- `POST /api/issues/:id/approve` and `/reject` — human decision gate.
- `POST /api/issues/:id/recheck` — re-crawl the source/link and close the tracker record only on verified fix.
- `POST /api/demo/reset` and `/api/demo/fix-broken-link` — reset or flip the deterministic TC4 target.
- `GET /api/test-results` and `POST /api/test-results` — latest official test results and evidence.
- `GET /api/health` — service readiness.

## Run and test

From the repository root, install dependencies once:

```bash
cd server && npm install
cd ../web && npm ci
```

Start the API and UI in separate terminals:

```bash
cd server && npm run dev
# separate terminal
cd web && npm run dev
```

Open the Vite app at `http://localhost:3001`. It proxies API routes to the API server on port 3002; the prefilled demo site is `http://127.0.0.1:3002/demo/`.

Automated tests include the actual local HTTP demo site and all four official scenarios:

```bash
cd server
npm test       # includes the real HTTP TC1–TC4 end-to-end test
npm run build
```

To run the evidence-producing test runner against a server that is already running:

```bash
cd server && npm run test:demo
```

That command creates `docs/evidence/tc1/result.json` through `tc4/result.json`, `docs/evidence/latest-run.json`, and persists results in SQLite. Set `FIXLOOP_API_URL` / `FIXLOOP_SITE_URL` to target a deployed instance instead of localhost.

Optional settings are in `.env.example`. By default the built-in crawler is enabled; `AUDIT_ENGINE_MODULE` is only needed to override it. GitHub filing requires both `GITHUB_TOKEN` and `GITHUB_REPOSITORY=owner/repo`; otherwise the durable mock tracker is used. Claude drafts require `ANTHROPIC_API_KEY` and fall back to templates when unavailable.

## Team handoff note

The plan says changes to `shared/types.ts` and `schema.sql` should be agreed in the group chat before merging. Those are the proposed section-11 contracts and schema; review them with the team before merging.
