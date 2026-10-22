import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { HttpAuditEngine } from "../src/crawler/auditEngine";
import { PoliteFetcher } from "../src/crawler/fetcher";

async function listen(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

test("PoliteFetcher sends HEAD through redirects and never reads a HEAD response body", async (t) => {
  const requests: Array<{ method: string; url: string }> = [];
  const { server, baseUrl } = await listen((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "" });
    if (request.url === "/start") {
      response.writeHead(302, { Location: "/final" });
      response.end("redirect body");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/html" });
    response.end("this body must not be read by a HEAD request");
  });
  t.after(() => server.close());

  const fetcher = new PoliteFetcher({ rateLimitMs: 0, retries: 0, timeoutMs: 1_000 });
  const result = await fetcher.fetch(`${baseUrl}start`, { method: "HEAD" });
  const fallback = await fetcher.fetch(`${baseUrl}status-only`, { method: "GET", readBody: false });

  assert.equal(result.statusCode, 404);
  assert.equal(result.body, "");
  assert.deepEqual(result.redirectChain, [`${baseUrl}start`, `${baseUrl}final`]);
  assert.equal(fallback.statusCode, 404);
  assert.equal(fallback.body, "");
  assert.deepEqual(requests, [
    { method: "HEAD", url: "/start" },
    { method: "HEAD", url: "/final" },
    { method: "GET", url: "/status-only" },
  ]);
});

test("link probes fall back to GET when the server rejects HEAD", async (t) => {
  const requests: Array<{ method: string; url: string }> = [];
  const { server, baseUrl } = await listen((request, response) => {
    const method = request.method ?? "";
    const url = request.url ?? "";
    requests.push({ method, url });

    if (url === "/robots.txt") {
      response.writeHead(404);
      response.end();
      return;
    }
    if (url === "/" && method === "GET") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<html><head><title>Home</title></head><body><a href="/target">Target</a></body></html>');
      return;
    }
    if (url === "/target" && method === "HEAD") {
      response.writeHead(405, { "Content-Type": "text/html" });
      response.end();
      return;
    }
    if (url === "/target" && method === "GET") {
      response.writeHead(404, { "Content-Type": "text/html" });
      response.end("Not found");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  t.after(() => server.close());

  const engine = new HttpAuditEngine({ rateLimitMs: 0, retries: 0, timeoutMs: 1_000 });
  const plan = await engine.plan(baseUrl, 1);
  const snapshot = await engine.crawl(plan, 1);

  assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.links[0]?.statusCode, 404);
  assert.ok(requests.some((request) => request.method === "HEAD" && request.url === "/target"));
  assert.ok(requests.some((request) => request.method === "GET" && request.url === "/target"));
});
