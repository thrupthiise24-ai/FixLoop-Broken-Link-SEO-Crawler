import assert from "node:assert/strict";
import test from "node:test";
import type { CrawlSnapshot } from "../../shared/types";
import { detectIssues } from "../src/detectors";

test("detectors flag 404s and exactly three-hop redirects with evidence", () => {
  const snapshot: CrawlSnapshot = {
    pages: [{ url: "https://site.test/about", depth: 1, statusCode: 200, title: "About" }],
    links: [
      {
        sourceUrl: "https://site.test/about",
        targetUrl: "https://site.test/missing",
        statusCode: 404,
        outcome: "error",
        internal: true,
      },
      {
        sourceUrl: "https://site.test/about",
        targetUrl: "https://site.test/old",
        statusCode: 200,
        redirectChain: [
          "https://site.test/old",
          "https://site.test/a",
          "https://site.test/b",
          "https://site.test/final",
        ],
        outcome: "ok",
        internal: true,
      },
    ],
  };
  const findings = detectIssues(snapshot);
  const broken = findings.find((finding) => finding.type === "broken_link");
  const chain = findings.find((finding) => finding.type === "redirect_chain");
  assert.equal(broken?.sourceUrl, "https://site.test/about");
  assert.equal(broken?.statusCode, 404);
  assert.equal(chain?.evidence?.redirectHops, 3);
  assert.equal(chain?.redirectChain?.length, 4);
});

test("timeouts become uncertain findings and are not called broken without an HTTP response", () => {
  const snapshot: CrawlSnapshot = {
    pages: [],
    links: [{
      sourceUrl: "https://site.test/about",
      targetUrl: "https://site.test/slow",
      statusCode: null,
      outcome: "timeout",
      internal: true,
      error: "request timed out",
    }],
  };
  const finding = detectIssues(snapshot).find((item) => item.type === "broken_link");
  assert.equal(finding?.outcome, "timeout");
  assert.equal(finding?.statusCode, undefined);
  assert.match(String(finding?.message), /retry/i);
});

test("SEO detectors report missing title, meta, H1, image alt, and duplicate titles", () => {
  const snapshot: CrawlSnapshot = {
    pages: [
      {
        url: "https://site.test/no-title",
        depth: 1,
        statusCode: 200,
        title: null,
        metaDescription: null,
        h1Count: 0,
        imagesMissingAlt: ["https://site.test/image.png"],
      },
      { url: "https://site.test/dup-a", depth: 1, statusCode: 200, title: "Same title", metaDescription: "One", h1Count: 1 },
      { url: "https://site.test/dup-b", depth: 1, statusCode: 200, title: "same title", metaDescription: "Two", h1Count: 1 },
    ],
    links: [],
  };
  const types = detectIssues(snapshot).map((finding) => finding.type);
  assert.ok(types.includes("missing_title"));
  assert.ok(types.includes("missing_meta_description"));
  assert.ok(types.includes("missing_h1"));
  assert.ok(types.includes("missing_alt"));
  assert.ok(types.includes("duplicate_title"));
});
