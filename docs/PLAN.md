# Broken Link & SEO Crawler: Hackathon Plan
Team of 3 · Build window 20 to 22 Oct 2026 · Build & Submit opened 20 Oct, 11:00 AM IST

## 1. The problem in simple words
Build an AI agent that scans a website, finds broken links and pages with missing titles, and files issues for them. A human must approve before anything is filed. After someone fixes a problem, the agent re-checks and closes the issue only if it is really fixed.
The agent must produce an issue list grouped by page, with a fix status for every issue (open, fixed, still failing, pending).

## 2. How the agent works
1. **Collect the details:** site URL and limits (for example, crawl at most 200 pages).
2. **Plan the next steps:** prioritise pages by importance, with the home page and navigation pages first.
3. **Find the information:** crawl the website, follow links, and record status codes, redirects and titles.
4. **Take action (human approval required):** propose issues, wait for a person to approve, then file them. Retries must never create duplicates.
5. **Check the result:** re-crawl after a fix and close the issue only if the problem is gone.

## 3. Official test cases
| # | Scenario | Expected result |
|---|----------|-----------------|
| TC1 | An internal link returns 404 | Issue created, naming the source page that contains the bad link |
| TC2 | A link goes through a three-hop redirect chain | Flagged |
| TC3 | Crawl limit of 200 pages | Limit respected, remaining pages listed |
| TC4 | A broken link is fixed | Agent re-checks and the issue is closed |

For every test case we must show the input, the expected result, the actual result and the evidence. If anything differs from the expectation, we explain why instead of hiding it.

## 4. Rules, submission and scoring
Rules from the brief:
- Run every official test case and show input, result and evidence for each.
- Ask for human approval before any action that cannot easily be undone (filing issues).
- Use mock or synthetic data when personal or sensitive information is involved.
- Do not bypass OTP or CAPTCHA.
- Only crawl a site we have permission to test. We will build our own demo site.
- Mandatory submission: a deployed working AI agent, source evidence, a presentation and the test case results.

| Scoring criterion | Points |
|---|---|
| Agentic capability (plan, decide, act) | 25 |
| Problem fit and usefulness | 20 |
| Technical implementation | 20 |
| Innovation | 15 |
| User experience | 10 |
| Presentation | 10 |

Agentic capability is the biggest bucket, so the UI must visibly show the agent planning (why a page was crawled first), deciding (why something is an issue) and acting (propose, approve, file, re-verify).

## 5. Architecture
Flow: Web UI starts a run, the Agent core plans and crawls, the Detector turns evidence into issues, issues wait at the Approval gate, the Issue filer files approved issues, and the Re-checker verifies fixes. SQLite stores everything.

| Component | Job |
|---|---|
| Web UI | Enter URL and limit, show the plan, show issues grouped by page, Approve and Reject buttons, status badges |
| Planner | Ranks pages by importance, enforces the page limit, records the not-crawled list |
| Crawler | Fetches pages, follows links, records status codes, redirect hops, titles; respects robots.txt and rate limits |
| Detector | Applies rules: broken links, redirect chains of 3 or more hops, missing titles, plus extra SEO checks |
| Approval gate | Holds proposed issues as pending until a human approves |
| Issue filer | Files approved issues to GitHub (or a mock tracker) using a dedupe key so retries never duplicate |
| Re-checker | Re-crawls affected pages after a fix; closes the issue only if the problem is gone |
| SQLite | Runs, pages, links, issues, evidence, approvals |
| Demo site | Our own site with planted problems, so every test case is reproducible and permitted |

## 6. Feature scope
### Must have (the 4 test cases, end to end):
- Crawl with page limit and prioritisation, not-crawled list
- Broken link detection (404 and other errors) with the source page recorded
- Redirect chain detection (3 or more hops)
- Missing title detection
- Approval gate, idempotent issue filing, re-check and close
- Issue list grouped by page with fix status
- Evidence stored per issue: source page, bad URL, status code, redirect chain, time checked

### Should have (cheap, high value):
- Duplicate, too-long and generic titles
- Missing or duplicate meta description
- Missing H1 or multiple H1s
- Images missing alt text, broken image, CSS and JS files
- Severity levels (high, medium, low)
- Root-cause grouping: one broken footer link on 150 pages becomes one issue listing 150 sources
- LLM-written issue drafts (title, plain-English explanation, suggested fix) that the human approves
- Uncertain state: a timeout is marked uncertain and retried instead of being called broken
- Permission checkbox before every run

### Stretch (only if everything above is green):
- Crawl diffing between runs (new, fixed, regressed) and a 0 to 100 site health score
- Orphan pages and sitemap comparison, click depth, soft 404s, canonical and noindex checks
- axe-core accessibility audit through Playwright
- Duplicate content detection, response time and page weight
- CSV export, scheduled re-checks, Slack or email notification

## 7. Data model
- `runs`: id, site_url, page_limit, status, started_at, finished_at
- `pages`: id, run_id, url, depth, priority, priority_reason, status_code, title, crawled_at, crawled (true or false)
- `links`: id, run_id, source_page_id, target_url, status_code, redirect_chain (JSON), checked_at
- `issues`: id, run_id, dedupe_key, type, severity, source_page_id, bad_url, status (pending_approval, open, fixed, still_failing, rejected, uncertain), title, description, suggested_fix, tracker_url, created_at, approved_at, closed_at
- `evidence`: id, issue_id, kind, payload (JSON), captured_at
- `test_runs`: id, test_case (TC1 to TC4), input, expected, actual, passed, evidence_path, notes
- Dedupe key: sha1(source_page + bad_url + issue_type). A unique index on it makes duplicate filing impossible even if a request is retried.

## 8. Tech stack
- **Backend:** Node.js + TypeScript, Express, better-sqlite3
- **Crawling:** built-in fetch (manual redirects, so every hop is captured) + Cheerio; Playwright only if a page needs JavaScript rendering
- **Frontend:** Vite + React (plain and simple, no heavy UI library)
- **LLM:** Claude API for issue drafts and title-quality judgement, with a template fallback if the API fails
- **Tracker:** GitHub Issues API, with a mock tracker as fallback
- **Hosting:** one deployment (Render, Railway or Fly.io) with a persistent volume for SQLite; the demo site is served by the same app under `/demo`. Confirm free-tier limits before Day 2 evening.

## 9. Folder structure
```
broken-link-seo-crawler/
├── README.md
├── package.json                  (npm workspaces: server, web)
├── .env.example
├── .gitignore
├── Dockerfile
├── .github/
│   └── workflows/ci.yml
├── shared/
│   └── types.ts                  (Issue, Page, Link, Run types used by server and web)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              (app entry, serves web build and /demo)
│   │   ├── config.ts
│   │   ├── api/
│   │   │   ├── runs.routes.ts
│   │   │   ├── issues.routes.ts
│   │   │   ├── approvals.routes.ts
│   │   │   └── demo.routes.ts    (toggle the fixed link for TC4)
│   │   ├── agent/
│   │   │   ├── orchestrator.ts   (runs plan, crawl, detect, propose)
│   │   │   ├── planner.ts        (priority scoring, page limit)
│   │   │   ├── recheck.ts        (re-verify and close)
│   │   │   └── issueDrafter.ts   (LLM text with template fallback)
│   │   ├── crawler/
│   │   │   ├── fetcher.ts        (manual redirects, timeouts, retries)
│   │   │   ├── parser.ts         (Cheerio: links, title, meta, h1, images)
│   │   │   ├── queue.ts          (priority queue)
│   │   │   ├── robots.ts
│   │   │   └── normalizeUrl.ts
│   │   ├── detectors/
│   │   │   ├── brokenLinks.ts
│   │   │   ├── redirectChains.ts
│   │   │   ├── missingTitle.ts
│   │   │   ├── metaDescription.ts
│   │   │   ├── headings.ts
│   │   │   ├── imageAlt.ts
│   │   │   └── index.ts          (registry of all detectors)
│   │   ├── integrations/
│   │   │   ├── tracker.interface.ts
│   │   │   ├── githubTracker.ts
│   │   │   └── mockTracker.ts
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── client.ts
│   │   │   └── repositories/     (runs, pages, links, issues, evidence)
│   │   └── utils/
│   └── tests/
│       ├── detectors.test.ts
│       └── dedupe.test.ts
├── web/
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── api/client.ts
│       ├── pages/                (RunSetup, RunDetail, TestResults)
│       └── components/           (PlanPanel, IssueList, IssueCard, ApprovalButtons, StatusBadge, HealthScore)
├── demo-site/
│   ├── generate.ts               (builds 250+ pages with planted problems)
│   └── public/                   (generated output, served at /demo)
├── scripts/
│   ├── run-test-cases.ts         (runs TC1 to TC4, writes results to DB and evidence/)
│   └── seed.ts
└── docs/
    ├── PLAN.md                   (this document)
    ├── architecture.md
    ├── test-cases.md
    ├── evidence/
    │   ├── tc1/  tc2/  tc3/  tc4/   (screenshots, logs, JSON)
    └── presentation/
```

## 10. Team roles
| Member | Role | Owns these folders |
|---|---|---|
| Member A | Crawler and detection engine | `server/src/crawler`, `server/src/detectors`, `server/src/agent/planner.ts` |
| Member B | Agent logic, data and integrations | `server/src/db`, `server/src/api`, `server/src/agent (orchestrator, recheck, issueDrafter)`, `server/src/integrations`, `shared` |
| Member C | Frontend, demo site, evidence and presentation | `web`, `demo-site`, `scripts`, `docs`, `deployment` |

Each person edits only their own folders. Anything that touches `shared/types.ts` or `schema.sql` is agreed in the group chat first.

### Member A: crawler and detection
- Fetcher with manual redirect handling (record every hop), timeouts, retries with backoff, polite rate limit, clear User-Agent
- Parser: links, title, meta description, H1s, images with alt
- URL normalisation; skip mailto:, tel:, and #fragments; internal vs external links
- Planner: priority score (depth, number of inbound links, nav links), page limit of 200, not-crawled list with reasons
- Detectors: broken links (TC1), redirect chains of 3 or more (TC2), missing title; then duplicate title, meta description, H1, image alt
- Unit tests for each detector

## 11. Contracts to agree in the first hour
- `shared/types.ts`: Run, Page, Link, Issue, Evidence
- Issue types: `broken_link`, `redirect_chain`, `missing_title`, `duplicate_title`, `missing_meta_description`, `missing_h1`, `missing_alt`
- Issue statuses: `pending_approval`, `open`, `fixed`, `still_failing`, `rejected`, `uncertain`
- API endpoints:
  - `POST /api/runs` (site_url, page_limit, permission_confirmed)
  - `GET /api/runs/:id` (status, plan, not-crawled list)
  - `GET /api/runs/:id/issues` (grouped by page)
  - `POST /api/issues/:id/approve` and `POST /api/issues/:id/reject`
  - `POST /api/issues/:id/recheck`
  - `POST /api/demo/fix-broken-link` (for TC4)
  - `GET /api/test-results`
- Detector function signature: takes a crawled page and its links, returns a list of proposed issues with evidence
- Tracker interface: `createIssue`, `closeIssue`, `findByDedupeKey`

## 12. Timeline (20 to 22 October)
- **Tue 20 Oct (today):** foundation
- **Wed 21 Oct:** core build and deployment
- **Thu 22 Oct:** evidence, polish, submit
