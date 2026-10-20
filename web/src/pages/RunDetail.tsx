
import React, { useEffect, useState } from "react";

type Issue = {
  id: string | number;
  type?: string;
  title?: string;
  description?: string;
  source_page?: string;
  source_url?: string;
  bad_url?: string;
  status_code?: number;
  severity?: string;
  status?: string;
  suggested_fix?: string;
  redirect_chain?: string[];
};

type Run = {
  id?: string | number;
  status?: string;
  site_url?: string;
  page_limit?: number;
  crawled_count?: number;
  total_pages?: number;
  plan?: Array<{
    url?: string;
    priority?: number;
    priority_reason?: string;
    reason?: string;
    status?: string;
  }>;
  not_crawled?: Array<{
    url?: string;
    reason?: string;
  }>;
};

export default function RunDetail() {
  const [runId, setRunId] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadRun(id: string) {
    if (!id.trim()) {
      setMessage("Enter a run ID first.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const [runResponse, issueResponse] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(id)}`),
        fetch(`/api/runs/${encodeURIComponent(id)}/issues`),
      ]);

      if (!runResponse.ok) {
        throw new Error("Could not load this run. Check the run ID and backend.");
      }

      const runResult = await runResponse.json();
      const issueResult = issueResponse.ok
        ? await issueResponse.json()
        : [];

      setRun(runResult.run ?? runResult);
      const receivedIssues = Array.isArray(issueResult)
        ? issueResult
        : issueResult.issues ?? [];

      setIssues(receivedIssues);
      setMessage("Run details loaded.");
    } catch (error) {
      setRun(null);
      setIssues([]);
      setMessage(
        error instanceof Error ? error.message : "Unable to load the run."
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateIssue(
    issueId: string | number,
    action: "approve" | "reject" | "recheck"
  ) {
    setMessage("");

    try {
      const response = await fetch(
        `/api/issues/${encodeURIComponent(String(issueId))}/${action}`,
        { method: "POST" }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.message || result.error || `Could not ${action} issue.`
        );
      }

      setMessage(`Issue ${action} request completed.`);
      if (runId) await loadRun(runId);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Action failed."
      );
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      setRunId(id);
      void loadRun(id);
    }
  }, []);

  const groupedIssues = issues.reduce<Record<string, Issue[]>>(
    (groups, issue) => {
      const source = issue.source_page || issue.source_url || "Source page unavailable";
      if (!groups[source]) groups[source] = [];
      groups[source].push(issue);
      return groups;
    },
    {}
  );

  const plan = run?.plan ?? [];
  const notCrawled = run?.not_crawled ?? [];

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <a href="/" style={styles.back}>← FixLoop</a>
        <span style={styles.badge}>CRAWL DETAILS</span>
      </header>

      <h1 style={styles.heading}>Crawl overview</h1>
      <p style={styles.muted}>
        Inspect the agent's plan, review evidence, and approve or reject issues.
      </p>

      <section style={styles.panel}>
        <label style={styles.label} htmlFor="runId">Run ID</label>
        <div style={styles.searchRow}>
          <input
            id="runId"
            style={styles.input}
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            placeholder="Enter the run ID"
          />
          <button
            style={styles.button}
            disabled={loading}
            onClick={() => void loadRun(runId)}
          >
            {loading ? "Loading..." : "Load run"}
          </button>
        </div>
        {message && <p role="status" style={styles.message}>{message}</p>}
      </section>

      {run && (
        <>
          <section style={styles.metrics}>
            <Metric label="Run status" value={run.status ?? "Unknown"} />
            <Metric label="Pages crawled" value={String(run.crawled_count ?? "—")} />
            <Metric label="Page limit" value={String(run.page_limit ?? "—")} />
            <Metric label="Issues found" value={String(issues.length)} />
          </section>

          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Run information</h2>
            <p><strong>Website:</strong> {run.site_url ?? "Not provided"}</p>
            <p><strong>Run ID:</strong> {String(run.id ?? runId)}</p>
            <p>
              <strong>Total pages reported:</strong>{" "}
              {run.total_pages ?? "Not available"}
            </p>
          </section>

          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Agent plan</h2>
            <p style={styles.muted}>
              Pages should be prioritised using importance, navigation links,
              crawl depth, and other planner evidence.
            </p>

            {plan.length === 0 ? (
              <p style={styles.empty}>No plan data was returned by the API.</p>
            ) : (
              plan.map((page, index) => (
                <article style={styles.planItem} key={page.url ?? index}>
                  <div>
                    <strong>{page.url ?? `Page ${index + 1}`}</strong>
                    <p style={styles.muted}>
                      {page.priority_reason ?? page.reason ?? "No priority reason supplied"}
                    </p>
                  </div>
                  <span style={styles.smallBadge}>
                    Priority: {page.priority ?? "—"}
                  </span>
                </article>
              ))
            )}

            <h3 style={styles.subheading}>Not crawled</h3>
            {notCrawled.length === 0 ? (
              <p style={styles.empty}>No unvisited pages were reported.</p>
            ) : (
              notCrawled.map((page, index) => (
                <p key={page.url ?? index} style={styles.notCrawled}>
                  {page.url ?? "Unknown URL"} — {page.reason ?? "Reason not supplied"}
                </p>
              ))
            )}
          </section>

          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>Issues grouped by source page</h2>

            {Object.keys(groupedIssues).length === 0 ? (
              <p style={styles.empty}>No issues were returned for this run.</p>
            ) : (
              Object.entries(groupedIssues).map(([source, pageIssues]) => (
                <div key={source} style={styles.group}>
                  <h3 style={styles.subheading}>{source}</h3>

                  {pageIssues.map((issue) => (
                    <article key={issue.id} style={styles.issue}>
                      <div style={styles.issueHeader}>
                        <strong>{issue.title ?? issue.type ?? "Detected issue"}</strong>
                        <span style={styles.status}>
                          {(issue.status ?? "unknown").replaceAll("_", " ")}
                        </span>
                      </div>

                      <p style={styles.muted}>
                        {issue.description ?? "No description supplied."}
                      </p>

                      {issue.bad_url && (
                        <p style={styles.detail}>
                          <strong>Problem URL:</strong> {issue.bad_url}
                        </p>
                      )}

                      {issue.status_code !== undefined && (
                        <p style={styles.detail}>
                          <strong>HTTP status:</strong> {issue.status_code}
                        </p>
                      )}

                      {issue.severity && (
                        <p style={styles.detail}>
                          <strong>Severity:</strong> {issue.severity}
                        </p>
                      )}

                      {issue.redirect_chain && (
                        <div style={styles.evidence}>
                          <strong>Redirect evidence</strong>
                          {issue.redirect_chain.map((hop, index) => (
                            <p key={`${hop}-${index}`} style={styles.detail}>
                              {index + 1}. {hop}
                            </p>
                          ))}
                        </div>
                      )}

                      {issue.suggested_fix && (
                        <p style={styles.detail}>
                          <strong>Suggested fix:</strong> {issue.suggested_fix}
                        </p>
                      )}

                      <div style={styles.actions}>
                        <button
                          style={styles.approve}
                          onClick={() => void updateIssue(issue.id, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          style={styles.reject}
                          onClick={() => void updateIssue(issue.id, "reject")}
                        >
                          Reject
                        </button>
                        <button
                          style={styles.secondary}
                          onClick={() => void updateIssue(issue.id, "recheck")}
                        >
                          Recheck
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <p style={styles.muted}>{label}</p>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f4f7fb",
    color: "#172033",
    fontFamily: "Arial, sans-serif",
    padding: "28px",
    boxSizing: "border-box",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto 32px",
    display: "flex",
    justifyContent: "space-between",
  },
  back: { color: "#3157d5", fontWeight: 700, textDecoration: "none" },
  badge: {
    background: "#e7edff",
    color: "#3157d5",
    padding: "7px 12px",
    borderRadius: "20px",
    fontSize: "11px",
    fontWeight: 700,
  },
  heading: { maxWidth: "1100px", margin: "0 auto 8px", fontSize: "32px" },
  muted: { color: "#68748a", fontSize: "13px", lineHeight: 1.6 },
  panel: {
    maxWidth: "1100px",
    margin: "20px auto",
    padding: "24px",
    background: "#fff",
    border: "1px solid #e1e7f0",
    borderRadius: "14px",
    boxSizing: "border-box",
  },
  label: { display: "block", fontSize: "13px", fontWeight: 700, marginBottom: "8px" },
  searchRow: { display: "flex", gap: "10px", flexWrap: "wrap" },
  input: {
    flex: "1 1 240px",
    minWidth: 0,
    padding: "12px",
    border: "1px solid #d8dfeb",
    borderRadius: "8px",
  },
  button: {
    padding: "12px 18px",
    border: 0,
    borderRadius: "8px",
    background: "#3157d5",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  message: { color: "#3157d5", fontSize: "13px", overflowWrap: "anywhere" },
  metrics: {
    maxWidth: "1100px",
    margin: "20px auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "12px",
  },
  metric: {
    padding: "18px",
    background: "#fff",
    border: "1px solid #e1e7f0",
    borderRadius: "12px",
  },
  metricValue: { fontSize: "20px", overflowWrap: "anywhere" },
  sectionTitle: { fontSize: "20px", marginTop: 0 },
  subheading: { fontSize: "15px", marginTop: "24px" },
  empty: { color: "#68748a", fontSize: "13px", padding: "10px 0" },
  planItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    padding: "14px 0",
    borderBottom: "1px solid #edf0f5",
    overflowWrap: "anywhere",
  },
  smallBadge: {
    flexShrink: 0,
    fontSize: "11px",
    color: "#3157d5",
    background: "#edf1ff",
    borderRadius: "6px",
    padding: "7px",
  },
  notCrawled: {
    fontSize: "12px",
    padding: "10px",
    background: "#f7f8fb",
    borderRadius: "6px",
    overflowWrap: "anywhere",
  },
  group: { borderTop: "1px solid #e7ebf2", paddingTop: "12px" },
  issue: {
    border: "1px solid #e1e7f0",
    borderRadius: "10px",
    padding: "16px",
    margin: "12px 0",
    overflowWrap: "anywhere",
  },
  issueHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  status: {
    background: "#fff4d9",
    color: "#875c00",
    padding: "5px 9px",
    borderRadius: "6px",
    fontSize: "11px",
  },
  detail: { fontSize: "12px", lineHeight: 1.6, overflowWrap: "anywhere" },
  evidence: { padding: "12px", background: "#f4f7fb", borderRadius: "8px" },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" },
  approve: {
    padding: "9px 13px",
    border: 0,
    borderRadius: "7px",
    background: "#16794b",
    color: "#fff",
    cursor: "pointer",
  },
  reject: {
    padding: "9px 13px",
    border: 0,
    borderRadius: "7px",
    background: "#b42318",
    color: "#fff",
    cursor: "pointer",
  },
  secondary: {
    padding: "9px 13px",
    border: "1px solid #d8dfeb",
    borderRadius: "7px",
    background: "#fff",
    cursor: "pointer",
  },
};
