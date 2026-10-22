import { PoliteFetcher } from '../server/src/crawler/fetcher.js';
import { parseHtml, type ParsedPage } from '../server/src/crawler/parser.js';
import { PriorityQueue, type QueueItem } from '../server/src/crawler/queue.js';
import { detectIssues } from '../server/src/detectors/index.js';
import type { CrawlPage, CrawlSnapshot, CrawledLink, DetectorFinding } from '../shared/types.js';
import http from 'node:http';

// Live smoke test for the HTTP crawler and SEO detectors against a planted demo site.
// Coverage: broken link (404), a three-hop redirect chain, missing title,
// duplicate H1, and an image without alt text.

function startDemoServer(): http.Server {
  return http.createServer((req, res) => {
    const path = req.url || '/';
    const html = (head: string, body: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`);
    };

    if (path === '/') {
      html(
        '<title>FixLoop Demo Home</title>',
        `<nav><a href="/about">About Us</a><a href="/services">Services</a>`
        + `<a href="/hop1">Special Promo (Redirect)</a><a href="/page-without-title">Untitled Page</a></nav>`
        + '<h1>Welcome to FixLoop Demo Site</h1><p>Planted issues verify the crawler and detectors.</p>',
      );
    } else if (path === '/about') {
      html(
        '<title>About Us - FixLoop</title>',
        '<h1>About Us</h1><p>Check out our <a href="/missing-team-member">Missing Team Member</a>.</p>'
        + '<a href="/">Back Home</a>',
      );
    } else if (path === '/services') {
      html(
        '<title>Services - FixLoop</title>',
        '<h1>Our Services</h1><img src="/assets/services-banner.jpg"><a href="/">Back Home</a>',
      );
    } else if (path === '/hop1') {
      res.writeHead(301, { Location: '/hop2' });
      res.end();
    } else if (path === '/hop2') {
      res.writeHead(302, { Location: '/hop3' });
      res.end();
    } else if (path === '/hop3') {
      res.writeHead(301, { Location: '/promo-final' });
      res.end();
    } else if (path === '/promo-final') {
      html('<title>Special Promo Destination</title>', '<h1>Special Promo</h1><a href="/">Back Home</a>');
    } else if (path === '/page-without-title') {
      // Planted: missing title plus duplicate H1s.
      html(
        '',
        '<h1>First Headline</h1><h1>Second Headline (Duplicate H1)</h1><a href="/">Back Home</a>',
      );
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
}

async function runSmokeTest(): Promise<void> {
  const server = startDemoServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log('\n===============================================================');
  console.log(' FixLoop live smoke test: crawler and detectors');
  console.log(` Target site: ${baseUrl}`);
  console.log('===============================================================\n');

  const fetcher = new PoliteFetcher({ rateLimitMs: 0 });
  const queue = new PriorityQueue<{ url: string; depth: number }>();
  const visited = new Set<string>();
  const pages = new Map<string, CrawlPage>();
  const links: CrawledLink[] = [];

  queue.push({ url: baseUrl, depth: 0, priority: 1000, priorityReason: 'Seed URL.' });
  while (queue.size > 0) {
    const item: QueueItem = queue.pop()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    console.log(`Crawling: ${item.url} (depth ${item.depth})`);

    const result = await fetcher.fetch(item.url);
    const page: CrawlPage = {
      url: item.url,
      depth: item.depth,
      statusCode: result.statusCode,
      crawledAt: result.checkedAt,
      crawled: true,
    };
    let parsed: ParsedPage | undefined;
    if (result.statusCode && result.statusCode < 400 && result.body) {
      parsed = parseHtml(result.body, item.url);
      page.title = parsed.title;
      page.metaDescription = parsed.metaDescription;
      page.h1Count = parsed.h1Count;
      page.imagesMissingAlt = parsed.imagesMissingAlt;
      for (const link of parsed.links) {
        links.push({
          sourceUrl: item.url,
          targetUrl: link.url,
          statusCode: null,
          outcome: 'unknown',
          internal: link.internal,
        });
        const probe = await fetcher.fetch(link.url, { method: 'HEAD', readBody: false });
        links[links.length - 1] = {
          ...links[links.length - 1],
          statusCode: probe.outcome === 'error' && probe.statusCode === null ? null : probe.statusCode,
          outcome: probe.outcome,
          redirectChain: probe.redirectChain.length > 1 ? probe.redirectChain : undefined,
          checkedAt: probe.checkedAt,
          error: probe.error,
        };
        if (link.internal && !visited.has(link.url)) {
          queue.push({ url: link.url, depth: item.depth + 1, priority: 500, priorityReason: 'Discovered link.' });
        }
      }
    }
    pages.set(item.url, page);
  }
  server.close();

  const snapshot: CrawlSnapshot = { pages: Array.from(pages.values()), links };
  const findings: DetectorFinding[] = detectIssues(snapshot);
  const hop3Targets = links.filter((link) => (link.redirectChain?.length ?? 0) >= 4);

  console.log('\n===============================================================');
  console.log(` SUMMARY: crawled ${pages.size} pages, detected ${findings.length} issues,`
    + ` ${hop3Targets.length} link(s) with three or more hops`);
  console.log('===============================================================\n');

  for (const finding of findings) {
    console.log(`[${finding.severity?.toUpperCase() ?? 'LOW'}] ${finding.type}`);
    console.log(`  Source page: ${finding.sourceUrl}`);
    if (finding.badUrl) console.log(`  Bad URL:     ${finding.badUrl}`);
    console.log('---------------------------------------------------------------');
  }

  const has404 = links.some((link) => link.statusCode === 404);
  if (!has404 || hop3Targets.length === 0 || findings.length === 0) {
    console.error('\nSmoke test failed: expected the 404, a 3+ hop redirect, and detector findings.');
    process.exit(1);
  }
  console.log('\nSmoke test completed successfully.\n');
}

runSmokeTest().catch((error) => {
  console.error('Smoke test failed:', error);
  server.close();
  process.exit(1);
});
