import test from 'node:test';
import assert from 'node:assert/strict';

import { Page, Link } from '../../shared/types.js';
import { BrokenLinksDetector } from '../src/detectors/brokenLinks.js';
import { RedirectChainsDetector } from '../src/detectors/redirectChains.js';
import { MissingTitleDetector } from '../src/detectors/missingTitle.js';
import { MetaDescriptionDetector } from '../src/detectors/metaDescription.js';
import { HeadingsDetector } from '../src/detectors/headings.js';
import { ImageAltDetector } from '../src/detectors/imageAlt.js';
import { runAllDetectors } from '../src/detectors/index.js';
import { normalizeUrl, isInternalUrl } from '../src/crawler/normalizeUrl.js';
import { Planner } from '../src/agent/planner.js';
import { parseHtml } from '../src/crawler/parser.js';

test('TC1: Broken internal link returning 404 generates issue with source page and evidence', () => {
  const page: Page = {
    id: 'page-1',
    run_id: 'run-1',
    url: 'https://demo.local/about',
    depth: 1,
    priority: 500,
    crawled: true,
  };

  const links: Link[] = [
    {
      id: 'link-1',
      run_id: 'run-1',
      source_page_id: 'page-1',
      source_page_url: 'https://demo.local/about',
      target_url: 'https://demo.local/missing-page',
      status_code: 404,
      is_internal: true,
      checked_at: '2026-10-20T10:00:00Z',
    },
    {
      id: 'link-2',
      run_id: 'run-1',
      source_page_id: 'page-1',
      source_page_url: 'https://demo.local/about',
      target_url: 'https://demo.local/valid-page',
      status_code: 200,
      is_internal: true,
      checked_at: '2026-10-20T10:00:00Z',
    },
  ];

  const detector = new BrokenLinksDetector();
  const issues = detector.detect({ page, links });

  assert.equal(issues.length, 1);
  const issue = issues[0];
  assert.equal(issue.type, 'broken_link');
  assert.equal(issue.severity, 'high');
  assert.equal(issue.source_page_url, 'https://demo.local/about');
  assert.equal(issue.bad_url, 'https://demo.local/missing-page');
  assert.ok(issue.title.includes('HTTP 404'));
  assert.equal(issue.evidence.length, 1);
  assert.equal(issue.evidence[0].payload.status_code, 404);
  assert.equal(issue.evidence[0].payload.source_page, 'https://demo.local/about');
});

test('TC2: Redirect chain of 3 or more hops is flagged with full hop evidence', () => {
  const page: Page = {
    id: 'page-2',
    run_id: 'run-1',
    url: 'https://demo.local/landing',
    depth: 1,
    priority: 500,
    crawled: true,
  };

  const links: Link[] = [
    {
      id: 'link-redirect-3hops',
      run_id: 'run-1',
      source_page_id: 'page-2',
      source_page_url: 'https://demo.local/landing',
      target_url: 'https://demo.local/old-link',
      status_code: 200,
      redirect_chain: [
        { url: 'https://demo.local/old-link', status_code: 301, location: 'https://demo.local/hop1' },
        { url: 'https://demo.local/hop1', status_code: 302, location: 'https://demo.local/hop2' },
        { url: 'https://demo.local/hop2', status_code: 301, location: 'https://demo.local/final' },
      ],
      is_internal: true,
      checked_at: '2026-10-20T10:05:00Z',
    },
    {
      id: 'link-redirect-1hop',
      run_id: 'run-1',
      source_page_id: 'page-2',
      source_page_url: 'https://demo.local/landing',
      target_url: 'https://demo.local/single-hop',
      status_code: 200,
      redirect_chain: [
        { url: 'https://demo.local/single-hop', status_code: 301, location: 'https://demo.local/dest' },
      ],
      is_internal: true,
    },
  ];

  const detector = new RedirectChainsDetector();
  const issues = detector.detect({ page, links });

  // Only the 3-hop link should be flagged
  assert.equal(issues.length, 1);
  const issue = issues[0];
  assert.equal(issue.type, 'redirect_chain');
  assert.equal(issue.bad_url, 'https://demo.local/old-link');
  assert.equal(issue.evidence[0].payload.hop_count, 3);
  assert.equal(issue.evidence[0].payload.hops.length, 3);
});

test('TC3: Planner applies 200-page limit and records prioritized plan and not-crawled list', () => {
  const planner = new Planner(200);

  // Generate 250 test candidate pages
  const candidates: Array<{ url: string; depth: number; priority: number; priorityReason: string }> = [];
  for (let i = 0; i < 250; i++) {
    const url = i === 0 ? 'https://demo.local/' : `https://demo.local/page-${i}`;
    const depth = i === 0 ? 0 : Math.floor(i / 50) + 1;
    const isNav = i < 10;
    const evalResult = planner.evaluatePriority(url, depth, isNav, 1);
    candidates.push({
      url,
      depth,
      priority: evalResult.score,
      priorityReason: evalResult.reason,
    });
  }

  // Sort by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  const partition = planner.partitionByLimit(candidates, 0);

  // Assert exactly 200 can be crawled, and remaining 50 are recorded in notCrawled
  assert.equal(partition.canCrawl.length, 200);
  assert.equal(partition.notCrawled.length, 50);
  assert.ok(partition.notCrawled[0].reason.includes('Crawl page limit of 200 reached'));
  // Home page must be ranked first with highest priority
  assert.equal(partition.canCrawl[0].url, 'https://demo.local/');
});

test('MissingTitleDetector detects missing title and duplicate title', () => {
  const pageNoTitle: Page = {
    id: 'p-no-title',
    run_id: 'run-1',
    url: 'https://demo.local/no-title',
    depth: 1,
    priority: 100,
    title: '',
    crawled: true,
  };

  const detector = new MissingTitleDetector();
  const issuesMissing = detector.detect({ page: pageNoTitle, links: [] });
  assert.equal(issuesMissing.length, 1);
  assert.equal(issuesMissing[0].type, 'missing_title');
  assert.equal(issuesMissing[0].severity, 'high');

  // Test duplicate title across run
  const pageDup1: Page = {
    id: 'p-dup-1',
    run_id: 'run-1',
    url: 'https://demo.local/p1',
    depth: 1,
    priority: 100,
    title: 'Acme Company - Overview',
    crawled: true,
  };
  const pageDup2: Page = {
    id: 'p-dup-2',
    run_id: 'run-1',
    url: 'https://demo.local/p2',
    depth: 1,
    priority: 100,
    title: 'Acme Company - Overview',
    crawled: true,
  };

  const issuesDup = detector.detect({
    page: pageDup1,
    links: [],
    allPagesInRun: [pageDup1, pageDup2],
  });
  assert.ok(issuesDup.some((i) => i.type === 'duplicate_title'));
});

test('Headings and ImageAlt detectors detect missing H1, multiple H1, and missing alt', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Test Page</title></head>
      <body>
        <h1>Primary Heading</h1>
        <h1>Secondary Duplicate Heading</h1>
        <img src="/logo.png" alt="Company Logo">
        <img src="/banner.jpg">
      </body>
    </html>
  `;
  const parsed = parseHtml(html, 'https://demo.local/page');
  const page: Page = {
    id: 'p-test',
    run_id: 'run-1',
    url: 'https://demo.local/page',
    depth: 1,
    priority: 100,
    crawled: true,
  };

  const headingsDetector = new HeadingsDetector();
  const headingIssues = headingsDetector.detect({ page, links: [], parseResult: parsed });
  assert.equal(headingIssues.length, 1);
  assert.equal(headingIssues[0].type, 'multiple_h1');

  const imageAltDetector = new ImageAltDetector();
  const altIssues = imageAltDetector.detect({ page, links: [], parseResult: parsed });
  assert.equal(altIssues.length, 1);
  assert.equal(altIssues[0].type, 'missing_alt');
  assert.equal(altIssues[0].bad_url, '/banner.jpg');
});

test('normalizeUrl handles relative paths, strips fragments, and filters mailto/tel', () => {
  const base = 'https://example.com/blog/article';

  const r1 = normalizeUrl('/about#team', base);
  assert.equal(r1.normalizedUrl, 'https://example.com/about');
  assert.equal(r1.isInternal, true);
  assert.equal(r1.isCrawlable, true);

  const r2 = normalizeUrl('mailto:support@example.com', base);
  assert.equal(r2.isCrawlable, false);

  const r3 = normalizeUrl('https://other.com/terms', base);
  assert.equal(r3.isInternal, false);
  assert.equal(r3.isCrawlable, true);

  assert.equal(isInternalUrl('https://example.com/docs', 'https://example.com/'), true);
  assert.equal(isInternalUrl('https://cdn.example.org/', 'https://example.com/'), false);
});
