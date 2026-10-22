import http from 'node:http';
import { Fetcher } from '../server/src/crawler/fetcher.js';
import { parseHtml } from '../server/src/crawler/parser.js';
import { CrawlQueue } from '../server/src/crawler/queue.js';
import { Planner } from '../server/src/agent/planner.js';
import { normalizeUrl } from '../server/src/crawler/normalizeUrl.js';
import { runAllDetectors } from '../server/src/detectors/index.js';
import { Page, Link } from '../shared/types.js';

// 1. Spin up an ephemeral demo server planted with TC1, TC2, and SEO flaws
const server = http.createServer((req, res) => {
  const path = req.url || '/';

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>FixLoop Demo Home</title></head>
        <body>
          <nav>
            <a href="/about">About Us</a>
            <a href="/services">Services</a>
            <a href="/hop1">Special Promo (Redirect)</a>
            <a href="/page-without-title">Untilted Page</a>
          </nav>
          <h1>Welcome to FixLoop Demo Site</h1>
          <p>This demo site contains planted issues to verify Crawler Member A capabilities.</p>
        </body>
      </html>
    `);
  } else if (path === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>About Us - FixLoop</title></head>
        <body>
          <h1>About Us</h1>
          <!-- TC1: Planted 404 broken link -->
          <p>Check out our <a href="/missing-team-member">Missing Team Member</a>.</p>
          <a href="/">Back Home</a>
        </body>
      </html>
    `);
  } else if (path === '/services') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Services - FixLoop</title></head>
        <body>
          <h1>Our Services</h1>
          <!-- Planted image missing alt -->
          <img src="/assets/services-banner.jpg">
          <a href="/">Back Home</a>
        </body>
      </html>
    `);
  } else if (path === '/hop1') {
    // TC2: Hop 1 (301 redirect to hop2)
    res.writeHead(301, { Location: '/hop2' });
    res.end();
  } else if (path === '/hop2') {
    // TC2: Hop 2 (302 redirect to hop3)
    res.writeHead(302, { Location: '/hop3' });
    res.end();
  } else if (path === '/hop3') {
    // TC2: Hop 3 (301 redirect to /promo-final) -> Total 3 hops
    res.writeHead(301, { Location: '/promo-final' });
    res.end();
  } else if (path === '/promo-final') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Special Promo Destination</title></head>
        <body>
          <h1>Special Promo</h1>
          <a href="/">Back Home</a>
        </body>
      </html>
    `);
  } else if (path === '/page-without-title') {
    // Planted missing title & multiple H1s
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <h1>First Headline</h1>
          <h1>Second Headline (Duplicate H1)</h1>
          <a href="/">Back Home</a>
        </body>
      </html>
    `);
  } else if (path === '/missing-team-member') {
    // TC1: 404 target
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('Not Found');
  }
});

async function runDemoCrawl() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log('\n===============================================================');
  console.log(' FixLoop Live Smoke Test: Crawler & Detectors (Member A)');
  console.log(` Target Site: ${baseUrl}`);
  console.log('===============================================================\n');

  const fetcher = new Fetcher({ rateLimitMs: 10 });
  const queue = new CrawlQueue();
  const planner = new Planner(50);

  // Seed root page
  const rootPriority = planner.evaluatePriority(baseUrl, 0, true, 1);
  queue.push({
    url: baseUrl,
    depth: 0,
    priority: rootPriority.score,
    priorityReason: rootPriority.reason,
    inboundCount: 1,
    isNav: true,
  });

  const allPages: Page[] = [];
  const allDetectedIssues: any[] = [];

  while (queue.size() > 0) {
    const item = queue.pop()!;
    console.log(`🔍 Crawling: ${item.url} (Priority: ${item.priority} pts, Depth: ${item.depth})`);

    const fetchResult = await fetcher.fetch(item.url);
    const parsed = fetchResult.bodyText ? parseHtml(fetchResult.bodyText, item.url) : undefined;

    const pageEntity: Page = {
      id: crypto.randomUUID(),
      run_id: 'live-test-run',
      url: item.url,
      depth: item.depth,
      priority: item.priority,
      priority_reason: item.priorityReason,
      status_code: fetchResult.statusCode,
      title: parsed?.title,
      meta_description: parsed?.meta_description,
      h1_tags: parsed?.h1_tags,
      crawled: true,
    };
    allPages.push(pageEntity);

    // Check all outbound links on this page
    const pageLinks: Link[] = [];
    if (parsed) {
      for (const linkObj of parsed.links) {
        const norm = normalizeUrl(linkObj.href, item.url);
        if (!norm.isCrawlable || !norm.normalizedUrl) continue;

        // Fetch link to test status code & redirect chains
        const linkFetch = await fetcher.fetch(norm.normalizedUrl);

        const linkEntity: Link = {
          id: crypto.randomUUID(),
          run_id: 'live-test-run',
          source_page_id: pageEntity.id,
          source_page_url: pageEntity.url,
          target_url: norm.normalizedUrl,
          status_code: linkFetch.statusCode,
          redirect_chain: linkFetch.redirectChain,
          is_internal: norm.isInternal,
          checked_at: new Date().toISOString(),
        };
        pageLinks.push(linkEntity);

        // If internal and not yet visited, enqueue it
        if (norm.isInternal && !queue.isVisited(norm.normalizedUrl)) {
          const evalRes = planner.evaluatePriority(norm.normalizedUrl, item.depth + 1, linkObj.isNav, 1);
          queue.push({
            url: norm.normalizedUrl,
            depth: item.depth + 1,
            priority: evalRes.score,
            priorityReason: evalRes.reason,
            inboundCount: 1,
            isNav: linkObj.isNav,
          });
        }
      }
    }

    // Run detectors on this page
    const issues = runAllDetectors({
      page: pageEntity,
      parseResult: parsed,
      links: pageLinks,
      allPagesInRun: allPages,
    });

    allDetectedIssues.push(...issues);
  }

  server.close();

  console.log('\n===============================================================');
  console.log(` SUMMARY: Crawled ${allPages.length} Pages | Detected ${allDetectedIssues.length} Issues`);
  console.log('===============================================================\n');

  allDetectedIssues.forEach((issue, idx) => {
    console.log(`[Issue #${idx + 1}] [${issue.severity.toUpperCase()}] ${issue.type}`);
    console.log(`  Title:        ${issue.title}`);
    console.log(`  Source Page:  ${issue.source_page_url}`);
    if (issue.bad_url) console.log(`  Bad URL:      ${issue.bad_url}`);
    console.log(`  Fix:          ${issue.suggested_fix}`);
    console.log(`  Evidence:     ${JSON.stringify(issue.evidence[0].payload, null, 2)}`);
    console.log('---------------------------------------------------------------');
  });

  console.log('\n✔ Live smoke test completed successfully!\n');
}

runDemoCrawl().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
