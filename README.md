# FixLoop — Broken Link & SEO Crawler

FixLoop audits a website that the operator is authorized to crawl. The agent prioritizes pages, finds broken links and SEO issues, stores evidence, asks a human before filing issues, and rechecks after a fix before closing a tracker issue.

For a fresh checkout, follow the detailed [first-time setup guide](SETUP.md).

## Quick start

Requirements: Node.js 20+ and npm.

```bash
cd server && npm ci
cd ../web && npm ci
```

Run the API and frontend in separate terminals:

```bash
cd server && npm run dev
```

```bash
cd web && npm run dev
```

Open **http://localhost:3001** for the FixLoop app. The UI proxies `/api`, `/demo`, and `/robots.txt` to the API on port **3002**. The demo site is `http://127.0.0.1:3002/demo/` and contains a controlled 404, a three-hop redirect chain, SEO examples, and 260 generated pages. The TC4 endpoint can restore the missing page after approval.

## Tests

```bash
cd server
npm test
npm run build
```

`npm test` includes a real HTTP end-to-end run against the generated demo site for TC1–TC4. To run the evidence-writing runner against a server already running on port 3002:

```bash
cd server && npm run test:demo
```

It writes per-case JSON under `docs/evidence/` and persists the latest results to SQLite. Set `FIXLOOP_API_URL` and `FIXLOOP_SITE_URL` to target another deployment.

## Safety and integrations

- Confirm permission for every crawl. Do not crawl a site without authorization.
- The crawler follows `robots.txt`, uses a clear User-Agent, applies a rate limit, and follows redirects manually to preserve evidence.
- By default only same-origin URLs inside the requested path are crawled. External URLs are recorded but not fetched.
- No issue is filed until a human approves it. Timeouts are uncertain, not falsely reported as confirmed broken links.
- SQLite is used by default. GitHub filing is enabled only when both `GITHUB_TOKEN` and `GITHUB_REPOSITORY` are configured; otherwise a durable mock tracker is used.
- Claude-generated drafts are optional; a template fallback is used if no key is configured or the API fails.

See [`docs/member-b-implementation.md`](docs/member-b-implementation.md) for the API and lifecycle details and [`docs/test-cases.md`](docs/test-cases.md) for the official scenario results.
