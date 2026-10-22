# Architecture

```text
Run setup (permission + limit)
        │ POST /api/runs
        ▼
Express API ──► RunRepository (SQLite)
        │
        ▼
AuditOrchestrator
   ├── Planner / PriorityQueue
   │     ├── robots.txt policy
   │     ├── same-origin/path-scope guard
   │     └── page cap + not-crawled reasons
   ├── PoliteFetcher (GET for pages; HEAD link probes with GET fallback; manual redirects)
   ├── Cheerio parser (links, title, description, H1, images)
   ├── Detector registry (404, ≥3-hop chain, missing title and extra SEO checks)
   ├── IssueDrafter (Claude optional; template fallback)
   └── SQLite (runs, pages, links, issues, evidence, events)
        │
        ▼
Pending approval ──human approves──► Mock/GitHub tracker (dedupe marker)
        │                                      │
        └── recheck ◄── fresh source + target ──┘
                 └── fixed only after verification; timeout/error stays uncertain
```

## Crawl and plan

The planner starts at the supplied URL, follows same-origin links within the starting path scope, and prioritizes the entry point, navigation links, shallower depth, and inbound links. It records the priority reason for each selected page and every known page not selected because of the cap or robots rules. The orchestrator independently enforces the maximum of 200 before persisting the plan and again before saving crawl results.

The crawler fetches each planned HTML page with GET (using a short-lived in-memory cache between plan and crawl), captures each redirect hop manually, and parses page metadata. In-scope link targets are checked with HEAD, so an off-plan target does not download a page body or count against the page cap; servers that reject HEAD (405/501) fall back to a status-only GET whose response body is discarded. The re-checker also uses GET for source documents and HEAD for targets. External links are retained as unchecked evidence and are not fetched. A target timeout is uncertain, not a confirmed broken link.

## Issue lifecycle and deduplication

```text
crawl/detect ─► pending_approval ──approve──► open ──verified gone──► fixed
                       │                         │                        │
                       └──reject──► rejected      ├──still present──► still_failing
                                                 └──timeout/error──► uncertain
fixed ──regression observed──► pending_approval (same issue; human approval required to reopen tracker)
```

The database enforces a unique SHA-1 key for `source page + bad URL + issue type`. A separate root-cause key groups one target problem across multiple source pages. Approval records the human decision before invoking the tracker. Both GitHub and the persistent mock tracker search/create by the dedupe marker, so retries do not make another issue. If a later audit finds a previously fixed issue again, it returns to `pending_approval`; approving the regression reopens the existing tracker record instead of creating a duplicate.

## Demo site

The server generates `/demo/` dynamically: `/about` contains a controllable broken link, `/old → /a → /b → /final` is a three-hop chain, `/pages/no-title`, duplicate-title pages and a missing-alt image are planted SEO cases, and 260 numbered pages exercise the page cap. `/api/demo/reset` and `/api/demo/fix-broken-link` reset/repair the TC4 target.
