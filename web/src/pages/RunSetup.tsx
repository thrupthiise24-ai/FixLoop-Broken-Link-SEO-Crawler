
import React, { useState } from "react";

export default function RunSetup() {
  const [siteUrl, setSiteUrl] = useState("http://localhost:4173");
  const [pageLimit, setPageLimit] = useState(200);
  const [permission, setPermission] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [runData, setRunData] = useState<any>(null);

  async function startCrawl(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setRunData(null);

    if (!permission) {
      setMessage("Please confirm that you have permission to crawl this website.");
      return;
    }

    try {
      const parsedUrl = new URL(siteUrl);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        setMessage("Please enter a valid HTTP or HTTPS website URL.");
        return;
      }
    } catch {
      setMessage("Please enter a valid website URL.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_url: siteUrl,
          page_limit: pageLimit,
          permission_confirmed: permission,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || "Unable to start the crawl.");
      }

      setRunData(result);
      setMessage("Crawl request submitted successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Check that the backend server is running.`
          : "Something went wrong while starting the crawl."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={styles.logo}>FL</div>
        <div>
          <h1 style={styles.brand}>FixLoop</h1>
          <p style={styles.subtitle}>Broken Link & SEO Crawler</p>
        </div>
        <span style={styles.headerTag}>AI-ASSISTED AUDIT</span>
      </header>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>WEBSITE HEALTH WORKSPACE</p>
        <h2>Find issues. Review evidence. Fix with confidence.</h2>
        <p style={styles.description}>
          Crawl an authorised website, discover broken links and SEO problems,
          and review suggested issues before filing them.
        </p>
      </section>

      <div style={styles.layout}>
        <section style={styles.panel}>
          <h3>Configure a new crawl</h3>
          <p style={styles.muted}>
            Choose your demo website and crawling limit.
          </p>

          <form onSubmit={startCrawl}>
            <label style={styles.label} htmlFor="siteUrl">
              Website URL
            </label>
            <input
              id="siteUrl"
              style={styles.input}
              type="url"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder="https://example.com"
              required
            />

            <label style={styles.label} htmlFor="pageLimit">
              Maximum pages to crawl
            </label>
            <select
              id="pageLimit"
              style={styles.input}
              value={pageLimit}
              onChange={(event) => setPageLimit(Number(event.target.value))}
            >
              <option value={50}>50 pages</option>
              <option value={100}>100 pages</option>
              <option value={200}>200 pages</option>
            </select>

            <label style={styles.permission}>
              <input
                type="checkbox"
                checked={permission}
                onChange={(event) => setPermission(event.target.checked)}
              />
              <span>
                I confirm that I own this website or have permission to crawl it.
              </span>
            </label>

            <button
              style={{
                ...styles.button,
                opacity: loading ? 0.65 : 1,
              }}
              type="submit"
              disabled={loading}
            >
              {loading ? "Starting crawl..." : "Start website audit →"}
            </button>
          </form>

          {message && (
            <div role="status" style={styles.message}>
              {message}
            </div>
          )}

          {runData && (
            <div style={styles.result}>
              <h4>Run response</h4>
              <pre style={styles.pre}>
                {JSON.stringify(runData, null, 2)}
              </pre>
            </div>
          )}
        </section>

        <aside style={styles.panel}>
          <h3>How FixLoop works</h3>
          <p style={styles.muted}>
            The agent plans, detects, proposes and verifies.
          </p>

          {[
            ["01", "Plan", "Prioritise important pages within the crawl limit."],
            ["02", "Crawl", "Collect page status codes, links and SEO metadata."],
            ["03", "Detect", "Find broken links and other issues with evidence."],
            ["04", "Approve", "Let a human approve or reject proposed issues."],
            ["05", "Recheck", "Verify fixes before marking issues as resolved."],
          ].map(([number, title, description]) => (
            <div style={styles.step} key={number}>
              <span style={styles.stepNumber}>{number}</span>
              <div>
                <strong>{title}</strong>
                <p style={styles.stepDescription}>{description}</p>
              </div>
            </div>
          ))}

          <div style={styles.notice}>
            <strong>Human approval required</strong>
            <p>
              Issues must not be filed automatically without the required
              human approval.
            </p>
          </div>
        </aside>
      </div>

      <footer style={styles.footer}>
        FixLoop · Broken Link & SEO Crawler · AI-assisted, human-approved
      </footer>
    </main>
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
    display: "flex",
    alignItems: "center",
    gap: "12px",
    maxWidth: "1100px",
    margin: "0 auto",
  },
  logo: {
    background: "#3157d5",
    color: "#fff",
    padding: "12px",
    borderRadius: "12px",
    fontWeight: 800,
  },
  brand: { margin: 0, fontSize: "22px" },
  subtitle: { margin: "4px 0 0", color: "#68748a", fontSize: "13px" },
  headerTag: {
    marginLeft: "auto",
    color: "#3157d5",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "1px",
  },
  hero: { maxWidth: "1100px", margin: "48px auto 28px" },
  eyebrow: {
    color: "#3157d5",
    fontWeight: 700,
    fontSize: "12px",
    letterSpacing: "1.5px",
  },
  description: { color: "#68748a", maxWidth: "650px", lineHeight: 1.7 },
  layout: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
    gap: "22px",
    maxWidth: "1100px",
    margin: "0 auto",
    alignItems: "start",
  },
  panel: {
    background: "#fff",
    padding: "26px",
    borderRadius: "16px",
    border: "1px solid #e1e7f0",
    boxShadow: "0 8px 25px rgba(25, 45, 85, 0.04)",
  },
  muted: { color: "#68748a", fontSize: "14px", lineHeight: 1.6 },
  label: { display: "block", fontWeight: 700, fontSize: "13px", margin: "22px 0 8px" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px",
    border: "1px solid #d8dfeb",
    borderRadius: "9px",
    background: "#fff",
    fontSize: "14px",
  },
  permission: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    fontSize: "13px",
    lineHeight: 1.6,
    margin: "20px 0",
  },
  button: {
    width: "100%",
    padding: "14px",
    border: 0,
    borderRadius: "9px",
    background: "#3157d5",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  message: {
    marginTop: "16px",
    padding: "12px",
    borderRadius: "8px",
    background: "#eef3ff",
    color: "#2445a8",
    fontSize: "13px",
    overflowWrap: "anywhere",
  },
  result: { marginTop: "18px" },
  pre: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    background: "#f4f7fb",
    padding: "12px",
    borderRadius: "8px",
    fontSize: "12px",
  },
  step: { display: "flex", gap: "14px", marginTop: "22px" },
  stepNumber: {
    flexShrink: 0,
    width: "34px",
    height: "34px",
    display: "grid",
    placeItems: "center",
    background: "#edf1ff",
    color: "#3157d5",
    borderRadius: "10px",
    fontWeight: 800,
    fontSize: "12px",
  },
  stepDescription: {
    color: "#68748a",
    fontSize: "13px",
    lineHeight: 1.6,
    margin: "5px 0 0",
  },
  notice: {
    marginTop: "26px",
    padding: "16px",
    background: "#fff8e8",
    border: "1px solid #f3dfaa",
    borderRadius: "10px",
    fontSize: "13px",
    lineHeight: 1.6,
  },
  footer: {
    maxWidth: "1100px",
    margin: "35px auto 0",
    color: "#7a8496",
    fontSize: "12px",
    textAlign: "center",
  },
};
