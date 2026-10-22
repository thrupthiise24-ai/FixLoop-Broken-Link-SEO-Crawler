import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Fetcher } from '../src/crawler/fetcher.js';
import { CrawlQueue } from '../src/crawler/queue.js';
import { RobotsParser } from '../src/crawler/robots.js';

test('CrawlQueue correctly handles priority order and duplicate prevention', () => {
  const queue = new CrawlQueue();

  queue.push({
    url: 'https://example.com/deep',
    depth: 3,
    priority: 100,
    priorityReason: 'deep link',
    inboundCount: 1,
    isNav: false,
  });

  queue.push({
    url: 'https://example.com/',
    depth: 0,
    priority: 1000,
    priorityReason: 'home page',
    inboundCount: 1,
    isNav: true,
  });

  queue.push({
    url: 'https://example.com/about',
    depth: 1,
    priority: 700,
    priorityReason: 'nav link',
    inboundCount: 1,
    isNav: true,
  });

  // Duplicate push with new inbound count
  const wasAdded = queue.push({
    url: 'https://example.com/about',
    depth: 1,
    priority: 750,
    priorityReason: 'updated nav link',
    inboundCount: 2,
    isNav: true,
  });
  assert.equal(wasAdded, false); // should update existing, not duplicate

  // Highest priority popped first
  const first = queue.pop();
  assert.equal(first?.url, 'https://example.com/');

  const second = queue.pop();
  assert.equal(second?.url, 'https://example.com/about');
  assert.equal(second?.inboundCount, 2);

  const third = queue.pop();
  assert.equal(third?.url, 'https://example.com/deep');

  assert.equal(queue.size(), 0);
  assert.equal(queue.visitedCount(), 3);
});

test('RobotsParser correctly parses rules, allows and disallows paths', () => {
  const robotsTxt = `
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public-doc

User-agent: BadBot
Disallow: /
`;

  const parser = new RobotsParser(robotsTxt);

  assert.equal(parser.isAllowed('https://example.com/', 'FixLoopBot'), true);
  assert.equal(parser.isAllowed('https://example.com/admin', 'FixLoopBot'), false);
  assert.equal(parser.isAllowed('https://example.com/admin/settings', 'FixLoopBot'), false);
  assert.equal(parser.isAllowed('https://example.com/private/secret', 'FixLoopBot'), false);
  assert.equal(parser.isAllowed('https://example.com/private/public-doc', 'FixLoopBot'), true);
  assert.equal(parser.isAllowed('https://example.com/blog', 'FixLoopBot'), true);

  assert.equal(parser.isAllowed('https://example.com/', 'BadBot'), false);
});

test('Fetcher captures manual redirect hops in redirectChain without auto-following silently', async () => {
  // Create an ephemeral HTTP server to test manual redirect hop capture
  const server = http.createServer((req, res) => {
    if (req.url === '/hop1') {
      res.writeHead(301, { Location: '/hop2' });
      res.end();
    } else if (req.url === '/hop2') {
      res.writeHead(302, { Location: '/final' });
      res.end();
    } else if (req.url === '/final') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Success</title></head><body><h1>Final Page</h1></body></html>');
    } else if (req.url === '/not-found') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('OK');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const fetcher = new Fetcher({ rateLimitMs: 0 });

    // Test multi-hop redirect
    const redirectResult = await fetcher.fetch(`${baseUrl}/hop1`);
    assert.equal(redirectResult.statusCode, 200);
    assert.equal(redirectResult.finalUrl, `${baseUrl}/final`);
    assert.equal(redirectResult.redirectChain.length, 2);
    assert.equal(redirectResult.redirectChain[0].status_code, 301);
    assert.equal(redirectResult.redirectChain[1].status_code, 302);
    assert.ok(redirectResult.bodyText?.includes('Final Page'));

    // Test 404 detection
    const notFoundResult = await fetcher.fetch(`${baseUrl}/not-found`);
    assert.equal(notFoundResult.statusCode, 404);
  } finally {
    server.close();
  }
});
