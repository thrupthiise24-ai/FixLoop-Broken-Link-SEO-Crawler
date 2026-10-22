import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { PoliteFetcher } from "../src/crawler/fetcher";
import { RobotsPolicy } from "../src/crawler/robots";

test("robots policy applies longest matching Allow/Disallow rules", async () => {
  const server = createHttpServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 0.001\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><title>test</title></html>");
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const robots = new RobotsPolicy(new PoliteFetcher({ rateLimitMs: 0, retries: 0 }));

  try {
    assert.equal((await robots.isAllowed(`${origin}/private/page`)).allowed, false);
    assert.equal((await robots.isAllowed(`${origin}/private/public/page`)).allowed, true);
    assert.equal((await robots.isAllowed(`${origin}/public/page`)).allowed, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
