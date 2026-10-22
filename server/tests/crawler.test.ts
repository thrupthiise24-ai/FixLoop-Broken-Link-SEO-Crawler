import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PoliteFetcher } from '../src/crawler/fetcher.js';
import { PriorityQueue } from '../src/crawler/queue.js';
import { normalizeUrl } from '../src/crawler/normalizeUrl.js';

test('PriorityQueue keeps the highest ranked item first and updates better priorities', () => {
  const queue = new PriorityQueue();

  queue.push({ url: 'https://example.com/deep', depth: 3, priority: 100, priorityReason: 'deep link' });
  queue.push({ url: 'https://example.com/', depth: 0, priority: 1000, priorityReason: 'home page' });
  queue.push({ url: 'https://example.com/about', depth: 1, priority: 700, priorityReason: 'nav link' });
  queue.push({ url: 'https://example.com/about', depth: 1, priority: 750, priorityReason: 'nav link' });

  const first = queue.pop();
  assert.equal(first?.url, 'https://example.com/');
  const second = queue.pop();
  assert.equal(second?.url, 'https://example.com/about');
  assert.equal(second?.priority, 750);
  const third = queue.pop();
  assert.equal(third?.url, 'https://example.com/deep');
  assert.equal(queue.size, 0);
});

test('normalizeUrl skips non-page schemes, strips fragments, and resolves relatives', () => {
  assert.equal(normalizeUrl('/docs#section', 'https://example.com/start'), 'https://example.com/docs');
  assert.equal(normalizeUrl('mailto:team@example.com'), null);
  assert.equal(normalizeUrl('javascript:void(0)'), null);
  assert.equal(normalizeUrl('ftp://example.com/file'), null);
  // A lone root or directory entry keeps its trailing slash; deeper paths lose it.
  assert.equal(normalizeUrl('https://example.com/dir/'), 'https://example.com/dir');
});

test('PoliteFetcher follows multi-hop redirects and reports plain 404s', async () => {
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
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('Not Found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const fetcher = new PoliteFetcher({ rateLimitMs: 0 });
    const redirectResult = await fetcher.fetch(`${baseUrl}/hop1`);
    assert.equal(redirectResult.statusCode, 200);
    assert.equal(redirectResult.finalUrl, `${baseUrl}/final`);
    assert.deepEqual(redirectResult.redirectChain, [
      `${baseUrl}/hop1`,
      `${baseUrl}/hop2`,
      `${baseUrl}/final`,
    ]);
    assert.ok(redirectResult.body.includes('Final Page'));

    const notFoundResult = await fetcher.fetch(`${baseUrl}/missing`);
    assert.equal(notFoundResult.statusCode, 404);
    assert.equal(notFoundResult.outcome, 'error');
  } finally {
    server.close();
  }
});
