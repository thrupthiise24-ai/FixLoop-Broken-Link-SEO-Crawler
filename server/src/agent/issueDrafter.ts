import type { DetectorFinding, IssueDraft } from "../../../shared/types";

export interface IssueDrafterConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface DraftResult extends IssueDraft {
  generatedBy: "anthropic" | "template";
}

const labels: Record<DetectorFinding["type"], string> = {
  broken_link: "Broken link",
  redirect_chain: "Long redirect chain",
  missing_title: "Missing page title",
  duplicate_title: "Duplicate page title",
  missing_meta_description: "Missing meta description",
  missing_h1: "Missing H1 heading",
  missing_alt: "Image missing alternative text",
};

function fallbackDraft(finding: DetectorFinding): IssueDraft {
  const label = labels[finding.type];
  const code = finding.statusCode == null ? "" : ` (HTTP ${finding.statusCode})`;
  const chain = finding.redirectChain ?? [];
  const evidence = chain.length > 0
    ? ` The observed chain has ${Math.max(0, chain.length - 1)} redirect hop(s).`
    : "";

  const issueDetail = finding.type === "broken_link"
    ? `The page ${finding.sourceUrl} links to ${finding.badUrl}, which did not return a successful response${code}.`
    : finding.type === "redirect_chain"
      ? `The link from ${finding.sourceUrl} to ${finding.badUrl} passes through a long redirect chain.${evidence}`
      : `The page ${finding.sourceUrl} has a ${label.toLowerCase()} that can reduce clarity for visitors and search engines.`;

  const suggestedFix = finding.type === "broken_link"
    ? "Update the link to a working destination, or remove it if the destination no longer exists. Recheck the URL after the change."
    : finding.type === "redirect_chain"
      ? "Point the source link directly at the final destination and update obsolete redirects where possible."
      : finding.type === "missing_title"
        ? "Add a concise, unique title that describes the page's main topic."
        : finding.type === "duplicate_title"
          ? "Write a distinct, accurate title for this page so it can be differentiated in search results."
          : finding.type === "missing_meta_description"
            ? "Add a short, page-specific meta description that summarizes the page."
            : finding.type === "missing_h1"
              ? "Add one clear H1 heading that describes the page's primary content."
              : "Add concise, meaningful alt text to the informative image; use empty alt text only for decorative images.";

  return {
    title: `${label}: ${finding.badUrl}`.slice(0, 180),
    description: `${issueDetail} The crawler recorded the source page and check result as evidence; review it before filing.`,
    suggestedFix,
  };
}

function parseDraft(text: string): IssueDraft | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned) as Partial<IssueDraft>;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const description = typeof value.description === "string" ? value.description.trim() : "";
    const suggestedFix = typeof value.suggestedFix === "string"
      ? value.suggestedFix.trim()
      : typeof (value as { suggested_fix?: unknown }).suggested_fix === "string"
        ? String((value as { suggested_fix: string }).suggested_fix).trim()
        : "";
    if (!title || !description || !suggestedFix) return null;
    return {
      title: title.slice(0, 180),
      description: description.slice(0, 1200),
      suggestedFix: suggestedFix.slice(0, 800),
    };
  } catch {
    return null;
  }
}

export class IssueDrafter {
  constructor(private readonly config: IssueDrafterConfig = {}) {}

  async draft(finding: DetectorFinding): Promise<DraftResult> {
    const fallback = fallbackDraft(finding);
    if (!this.config.apiKey) return { ...fallback, generatedBy: "template" };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8000);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model ?? "claude-3-5-haiku-latest",
            max_tokens: 450,
            temperature: 0.2,
            system: "Write concise, factual SEO issue drafts. Do not invent facts. Return only valid JSON with string keys title, description, suggestedFix. The result is a draft for human review, not an instruction to take action.",
            messages: [
              {
                role: "user",
                content: JSON.stringify({
                  type: finding.type,
                  sourceUrl: finding.sourceUrl,
                  badUrl: finding.badUrl,
                  statusCode: finding.statusCode ?? null,
                  redirectChain: finding.redirectChain ?? [],
                  detectorEvidence: finding.evidence ?? {},
                }),
              },
            ],
          }),
        });
        if (!response.ok) throw new Error(`Anthropic API returned HTTP ${response.status}`);
        const data = await response.json() as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = data.content?.find((item) => item.type === "text")?.text;
        const parsed = text ? parseDraft(text) : null;
        if (!parsed) throw new Error("The LLM response did not contain a valid issue draft.");
        return { ...parsed, generatedBy: "anthropic" };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // The template is deterministic and keeps an issue reviewable if the LLM is down.
      return { ...fallback, generatedBy: "template" };
    }
  }
}
