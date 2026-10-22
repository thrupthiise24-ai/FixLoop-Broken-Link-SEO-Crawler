
import React, { useEffect, useState } from "react";

type TestResult = {
  id: string;
  name: string;
  input: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL" | "PENDING";
  evidence?: string;
};

const testCases: TestResult[] = [
  {
    id: "TC1",
    name: "Detect internal broken link",
    input: "Crawl a site containing a broken /about link",
    expected: "Identify the broken URL and return HTTP 404",
    actual: "Waiting for test execution",
    status: "PENDING",
    evidence: "Source page, broken URL, HTTP status, timestamp",
  },
  {
    id: "TC2",
    name: "Detect redirect chain",
    input: "Crawl /old → /a → /b → /final",
    expected: "Detect and display the redirect chain",
    actual: "Waiting for test execution",
    status: "PENDING",
    evidence: "Redirect URLs and hop count",
  },
  {
    id: "TC3",
    name: "Respect crawl page limit",
    input: "Crawl a demo site containing 250+ pages",
    expected: "Stop at the selected limit and identify remaining pages",
    actual: "Waiting for test execution",
    status: "PENDING",
    evidence: "Crawled page count and unvisited pages",
  },
  {
    id: "TC4",
    name: "Recheck a fixed broken link",
    input: "Enable the demo fix and recheck the broken URL",
    expected: "Mark the issue as fixed or closed",
    actual: "Waiting for test execution",
    status: "PENDING",
    evidence: "Before-and-after status",
  },
];

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
    color: "#172033",
    padding: "32px",
    fontFamily: "Arial, sans-serif",
  },
  container: {
    maxWidth: "1100px",
    margin: "0 auto",
  },
  heading: {
    fontSize: "30px",
    marginBottom: "8px",
  },
  subtitle: {
    color: "#64748b",
    marginBottom: "24px",
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "14px",
    marginBottom: "24px",
  },
  card: {
    background: "#ffffff",
    padding: "18px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  },
  testCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "16px",
  },
  label: {
    color: "#64748b",
    fontSize: "13px",
    marginBottom: "6px",
  },
  value: {
    fontSize: "24px",
    fontWeight: 700,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },
  button: {
    border: 0,
    background: "#2563eb",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
  },
  error: {
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "16px",
  },
  note: {
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.6,
  },
};

function statusStyle(status: TestResult["status"]): React.CSSProperties {
  if (status === "PASS") {
    return {
      background: "#dcfce7",
      color: "#166534",
    };
  }

  if (status === "FAIL") {
    return {
      background: "#fee2e2",
      color: "#991b1b",
    };
  }

  return {
    background: "#fef3c7",
    color: "#92400e",
  };
}

export default function TestResults() {
  const [results, setResults] = useState<TestResult[]>(testCases);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadResults() {
      try {
        const response = await fetch("/api/test-results");

        if (!response.ok) {
          throw new Error("Test results API is not available yet.");
        }

        const data = await response.json();
        const received = Array.isArray(data)
          ? data
          : Array.isArray(data.results)
            ? data.results
            : null;

        if (!received) {
          throw new Error("The API returned an unexpected response.");
        }

        setResults(
          testCases.map((test) => {
            const result = received.find(
              (item: Partial<TestResult>) => item.id === test.id
            );

            return result ? { ...test, ...result } : test;
          })
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not load test results."
        );
      } finally {
        setLoading(false);
      }
    }

    loadResults();
  }, []);

  const passed = results.filter((test) => test.status === "PASS").length;
  const failed = results.filter((test) => test.status === "FAIL").length;
  const pending = results.filter((test) => test.status === "PENDING").length;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.row}>
          <div>
            <h1 style={styles.heading}>Test Results</h1>
            <p style={styles.subtitle}>
              Broken Link &amp; SEO Crawler — validation dashboard
            </p>
          </div>

          <button
            style={styles.button}
            onClick={() => window.location.reload()}
          >
            Refresh Results
          </button>
        </div>

        {error && (
          <div style={styles.error}>
            {error} Showing the predefined test cases until the API is
            connected.
          </div>
        )}

        <section style={styles.summary}>
          <div style={styles.card}>
            <div style={styles.label}>Total test cases</div>
            <div style={styles.value}>{results.length}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Passed</div>
            <div style={styles.value}>{passed}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Failed</div>
            <div style={styles.value}>{failed}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Pending</div>
            <div style={styles.value}>{pending}</div>
          </div>
        </section>

        {loading && (
          <p style={styles.note}>Loading results from the backend…</p>
        )}

        {results.map((test) => (
          <article key={test.id} style={styles.testCard}>
            <div style={styles.row}>
              <div>
                <div style={styles.label}>{test.id}</div>
                <h2 style={{ margin: "4px 0 12px", fontSize: "20px" }}>
                  {test.name}
                </h2>
              </div>

              <span
                style={{
                  ...statusStyle(test.status),
                  padding: "7px 12px",
                  borderRadius: "20px",
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                {test.status}
              </span>
            </div>

            <p>
              <strong>Input:</strong> {test.input}
            </p>

            <p>
              <strong>Expected result:</strong> {test.expected}
            </p>

            <p>
              <strong>Actual result:</strong> {test.actual}
            </p>

            <p style={styles.note}>
              <strong>Evidence:</strong> {test.evidence || "Not provided"}
            </p>
          </article>
        ))}

        <p style={styles.note}>
          Note: A test is marked PASS or FAIL only when its actual result is
          supplied by the test runner or backend. Pending tests are not
          counted as successful.
        </p>
      </div>
    </main>
  );
}
