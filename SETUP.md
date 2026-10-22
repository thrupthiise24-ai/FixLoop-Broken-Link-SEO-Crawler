# FixLoop — First-time setup

This guide gets the FixLoop UI and API running locally, then shows how to exercise the demo and test suite. The built-in demo is the safest first target; only crawl a live site if you own it or have explicit permission.

## 1. Prerequisites

- Git
- Node.js **20 or newer** and npm
- Two free local ports: **3001** for the web UI and **3002** for the API

Check versions:

```bash
node --version
npm --version
```

## 2. Get the repository and install dependencies

If you have not cloned the project yet:

```bash
git clone https://github.com/thrupthiise24-ai/FixLoop-Broken-Link-SEO-Crawler.git
cd FixLoop-Broken-Link-SEO-Crawler
```

From the repository root, install the server and web dependencies separately:

```bash
cd server
npm ci
cd ../web
npm ci
cd ..
```

`node_modules/` is local and ignored by Git. If you pull changes to either package’s lockfile, run `npm ci` again in that package directory.

## 3. Configure the API (optional for local demo)

The defaults are ready for a local demo. To customize settings, copy the example environment file into the server folder:

```bash
cp .env.example server/.env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example server/.env
```

The local `.env` file is ignored by Git. Common settings in it:

| Setting | Default | Purpose |
|---|---:|---|
| `PORT` | `3002` | API port |
| `DATABASE_PATH` | `./data/fixloop.sqlite` | Local SQLite database; the server resolves this relative to `server/` |
| `MAX_CRAWL_PAGES` | `200` | Maximum allowed pages per run; the server caps this at 200 |
| `GITHUB_TOKEN` + `GITHUB_REPOSITORY` | unset | Optional; enables filing approved issues to GitHub |
| `ANTHROPIC_API_KEY` | unset | Optional; enables AI-written issue drafts. Templates are used without it. |

No API key is required to run the app, crawl the built-in demo, or use the default mock tracker. Without GitHub credentials, approvals are filed to the local mock tracker—not to a real GitHub repository.

## 4. Start the app

Start each service in its own terminal, from the repository root:

**Terminal 1 — API**

```bash
npm run dev:api
```

Expected log: `FixLoop API listening on 0.0.0.0:3002`.

**Terminal 2 — web UI**

```bash
npm run dev
```

Expected Vite URL: `http://localhost:3001/`.

Open **http://localhost:3001/**. The UI proxies `/api`, `/demo`, and `/robots.txt` to the API on port 3002. The API health endpoint is `http://localhost:3002/api/health` (or through the UI proxy at `http://localhost:3001/api/health`). A visit to the API root on port 3002 redirects to the UI.

To stop either service, press `Ctrl+C` in its terminal.

## 5. Run the built-in demo

In the FixLoop UI:

1. Leave the prefilled URL as `http://127.0.0.1:3002/demo/` for the local demo.
2. Choose a page limit (50, 100, or 200).
3. Confirm permission and start the audit.
4. Open the run details to inspect the plan, findings, evidence, and issue actions.

The demo includes a planted internal 404 on `/about`, a three-hop redirect chain, SEO examples, and more than 250 generated pages. The 200-page official test should crawl 200 pages and list discovered pages left out by the cap.

**The page limit is a ceiling, not a target.** The crawler runs until it reaches the selected limit or runs out of eligible pages it can discover. It follows same-origin links found in the HTML, within the allowed path scope and robots rules. A run may therefore crawl fewer pages than the limit; increasing the limit does not discover orphaned pages or pages whose links are only created by JavaScript.

## 6. Issue workflow

- New findings wait in `pending approval`; crawling alone does not file them.
- **Approve** files the issue to the configured tracker (the local mock tracker by default). **Reject** dismisses it without filing.
- **Recheck** probes the affected page/target again. A still-present issue remains `still failing`; a timeout or transport failure is `uncertain`.
- A tracker issue is closed only after a recheck verifies the fix. An `open` issue has already been approved/filed, so it is rechecked rather than approved or rejected again.

For a real website, replace the demo URL only if you have authorization to audit it. The crawler respects `robots.txt`, rate-limits requests, and does not bypass CAPTCHA or OTP.

## 7. Run tests and builds

From the repository root:

```bash
npm run test:api
npm run build:all
```

The backend test suite includes the real local HTTP demo scenarios TC1–TC4. To run the evidence-producing official-case runner, first start the API as in section 4, then run:

```bash
npm run test:demo
```

The runner uses the local API at port 3002 by default. It writes the latest aggregate result to `docs/evidence/latest-run.json`, per-case results to `docs/evidence/tc1/` through `tc4/`, and persists results in SQLite. To target an authorized deployment instead, set `FIXLOOP_API_URL` and `FIXLOOP_SITE_URL` for that run.

## 8. Troubleshooting

- **Port already in use:** stop the old process or free port 3001 (UI) / 3002 (API). Do not start both services on the same port.
- **UI loads but API calls fail:** make sure the API is running on port 3002 and check `/api/health`. If you change the API port, set `PORT` for the API and set `FIXLOOP_API_PROXY=http://127.0.0.1:<port>` when starting Vite.
- **Only one page crawled:** the frontier may be empty because the start page has no eligible same-origin links, or robots/scope rules excluded the others. Check the plan and not-crawled reasons; the page cap does not force the crawler to invent URLs.
- **GitHub filing is unavailable:** configure both `GITHUB_TOKEN` and `GITHUB_REPOSITORY=owner/repo`; otherwise use the local mock tracker.
- **SQLite setup errors:** keep the default database path inside `server/data/` and make sure the server can write there.

## 9. Team ownership and shared contracts

Follow the hackathon plan’s folder ownership when making changes:

- **Member A:** `server/src/crawler/`, `server/src/detectors/`, and the planner.
- **Member B:** `server/src/db/`, `server/src/api/`, agent lifecycle/orchestration, integrations, and shared contracts.
- **Member C:** `web/`, `demo-site/`, `scripts/`, docs, deployment, and presentation.

The plan says changes to `shared/types.ts` and `server/src/db/schema.sql` must be agreed by the team before merging. Coordinate those contract/schema edits first, and review the evidence and tests before submission.
