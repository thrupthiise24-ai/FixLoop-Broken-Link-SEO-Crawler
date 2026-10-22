import assert from "node:assert/strict";
import test from "node:test";
import type { RecheckResult } from "../../shared/types";
import { IssueFilingService } from "../src/agent/issueFiling";
import { IssueRechecker } from "../src/agent/recheck";
import { openDatabase } from "../src/db/client";
import { EvidenceRepository } from "../src/db/repositories/evidence";
import { IssueRepository } from "../src/db/repositories/issues";
import { RunRepository } from "../src/db/repositories/runs";
import { MockTracker } from "../src/integrations/mockTracker";

function setupIssue(db: ReturnType<typeof openDatabase>, target = "https://example.test/missing") {
  const runs = new RunRepository(db);
  const issues = new IssueRepository(db);
  const run = runs.create({ siteUrl: "https://example.test/", pageLimit: 20, permissionConfirmed: true });
  const issue = issues.propose({
    runId: run.id,
    type: "broken_link",
    severity: "high",
    status: "pending_approval",
    sourceUrl: "https://example.test/about",
    badUrl: target,
    statusCode: 404,
    title: "Broken link",
    description: "The target URL returned 404.",
    suggestedFix: "Fix the target URL.",
  });
  return { issues, runs, run, issue };
}

test("approval is explicit and filing retries reuse the same mock issue", async () => {
  const db = openDatabase(":memory:");
  try {
    const { issues, issue, run } = setupIssue(db);
    const tracker = new MockTracker(db);
    const filing = new IssueFilingService({ issues, tracker });

    const filed = await filing.approveAndFile(issue.id);
    assert.equal(filed.status, "open");
    assert.ok(filed.approvedAt);
    assert.ok(filed.trackerId);

    const retry = await filing.approveAndFile(issue.id);
    assert.equal(retry.trackerId, filed.trackerId);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 1);

    const second = issues.propose({
      runId: run.id,
      type: "broken_link",
      severity: "high",
      status: "pending_approval",
      sourceUrl: "https://example.test/contact",
      badUrl: "https://example.test/another-missing",
      statusCode: 404,
      title: "Another broken link",
      description: "Another target is missing.",
      suggestedFix: "Update it.",
    });
    const rejected = filing.reject(second.id);
    assert.equal(rejected.status, "rejected");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 1);
  } finally {
    db.close();
  }
});

test("re-check distinguishes still failing, fixed, and uncertain outcomes", async () => {
  const db = openDatabase(":memory:");
  try {
    const { issues, issue } = setupIssue(db);
    const tracker = new MockTracker(db);
    const filing = new IssueFilingService({ issues, tracker });
    const filed = await filing.approveAndFile(issue.id);

    let nextResult: RecheckResult = { outcome: "ok", statusCode: 404 };
    const rechecker = new IssueRechecker({
      issues,
      evidence: new EvidenceRepository(db),
      tracker,
      probe: { async recheck() { return nextResult; } },
    });

    const failing = await rechecker.recheck(filed.id);
    assert.equal(failing.issue.status, "still_failing");
    assert.equal(failing.issue.trackerState, "open");

    nextResult = { outcome: "timeout", error: "request timed out" };
    const uncertain = await rechecker.recheck(filed.id);
    assert.equal(uncertain.issue.status, "uncertain");
    assert.equal(uncertain.issue.trackerState, "open");

    nextResult = { outcome: "ok", statusCode: 200 };
    const fixed = await rechecker.recheck(filed.id);
    assert.equal(fixed.issue.status, "fixed");
    assert.equal(fixed.issue.trackerState, "closed");
    assert.ok(fixed.issue.closedAt);
    assert.equal((db.prepare("SELECT state FROM mock_tracker_issues WHERE tracker_id = ?").get(filed.trackerId) as { state: string }).state, "closed");
    assert.ok(new EvidenceRepository(db).listForIssue(filed.id).some((item) => item.kind === "recheck"));
  } finally {
    db.close();
  }
});

test("a fixed issue regression reuses and reopens the prior tracker issue", async () => {
  const db = openDatabase(":memory:");
  try {
    const { issues, runs, run, issue } = setupIssue(db);
    const tracker = new MockTracker(db);
    const filing = new IssueFilingService({ issues, tracker });
    const filed = await filing.approveAndFile(issue.id);
    const rechecker = new IssueRechecker({
      issues,
      evidence: new EvidenceRepository(db),
      tracker,
      probe: { async recheck() { return { outcome: "ok", statusCode: 200 }; } },
    });
    const fixed = await rechecker.recheck(filed.id);
    assert.equal(fixed.issue.status, "fixed");

    const secondRun = runs.create({ siteUrl: run.siteUrl, pageLimit: 20, permissionConfirmed: true });
    const observedAgain = issues.propose({
      runId: secondRun.id,
      type: "broken_link",
      severity: "high",
      status: "pending_approval",
      sourceUrl: issue.sourceUrl,
      badUrl: issue.badUrl,
      statusCode: 404,
      title: issue.title,
      description: issue.description,
      suggestedFix: issue.suggestedFix,
    });
    assert.equal(observedAgain.id, issue.id);
    assert.equal(observedAgain.status, "pending_approval");
    assert.equal(observedAgain.statusCode, 404);
    assert.equal(observedAgain.approvedAt, null);

    const refiled = await filing.approveAndFile(observedAgain.id);
    assert.equal(refiled.status, "open");
    assert.equal(refiled.trackerId, filed.trackerId);
    assert.equal(refiled.trackerState, "open");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT state FROM mock_tracker_issues").get() as { state: string }).state, "open");
  } finally {
    db.close();
  }
});

test("a confirmed still-failing finding can still be approved or rejected", async () => {
  const db = openDatabase(":memory:");
  try {
    const { issues, issue } = setupIssue(db);
    const tracker = new MockTracker(db);
    const filing = new IssueFilingService({ issues, tracker });

    const checked = issues.markRechecked(issue.id, "still_failing", { statusCode: 404 });
    assert.equal(checked.status, "still_failing");
    const filed = await filing.approveAndFile(issue.id);
    assert.equal(filed.status, "open");
    assert.ok(filed.approvedAt);
    assert.ok(filed.trackerId);

    const second = setupIssue(db, "https://example.test/another-missing");
    issues.markRechecked(second.issue.id, "still_failing", { statusCode: 404 });
    const rejected = filing.reject(second.issue.id);
    assert.equal(rejected.status, "rejected");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM mock_tracker_issues").get() as { count: number }).count, 1);
  } finally {
    db.close();
  }
});
