# Official test cases — latest end-to-end run

Executed with `cd server && npm run test:demo` against the local API on port 3002 and the real HTTP crawler. This run used the generated 260-page demo site and a 200-page limit. All four checks passed; the runner also posted these results to `/api/test-results` and wrote the detailed evidence JSON files listed below. Link targets are checked with HEAD; GET is used only when a target rejects HEAD, and that fallback's response body is discarded.

| ID | Input | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| TC1 | Crawl `http://127.0.0.1:3002/demo/`; `/about` links to `/missing-page`. | Create a broken-link issue naming `/about` as the source and record HTTP 404 for the target. | Found a `broken_link` issue from `/demo/about` to `/demo/missing-page`, HTTP 404. | **PASS** | [`tc1/result.json`](evidence/tc1/result.json) |
| TC2 | Follow `/old → /a → /b → /final`. | Flag a chain with at least three redirects and retain its hops. | Flagged 3 hops: `/old`, `/a`, `/b`, `/final`. | **PASS** | [`tc2/result.json`](evidence/tc2/result.json) |
| TC3 | Crawl the generated site with a 200-page cap. | Never crawl more than 200 pages; list pages left out by the cap. | Crawled 200/200; discovered 269 pages; listed 69 as not crawled. | **PASS** | [`tc3/result.json`](evidence/tc3/result.json) |
| TC4 | Approve TC1, activate the demo fix, and recheck. | Keep the issue open while broken; mark it fixed and close it only after verification. | Before: HTTP 404. After: HTTP 200. Issue status `fixed`; mock tracker status `closed`. | **PASS** | [`tc4/result.json`](evidence/tc4/result.json) |

- Shared run ID: `5ebbee90-0557-4ac5-82c3-96d91a7fffcc`
- Aggregate evidence: [`latest-run.json`](evidence/latest-run.json)
- Re-run locally: start the API, then run `cd server && npm run test:demo`.
- Automated regression: `cd server && npm test` runs the same TC1–TC4 flow against an ephemeral local server, plus unit/API tests.
