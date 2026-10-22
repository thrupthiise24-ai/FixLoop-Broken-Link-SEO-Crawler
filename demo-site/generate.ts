export const DEMO_BASE_PATH = "/demo";
export const DEMO_PAGE_COUNT = 260;

export interface DemoResponse {
  statusCode: number;
  body: string;
  contentType: string;
  headers?: Record<string, string>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[character];
  });
}

function htmlPage(options: {
  title?: string;
  description?: string;
  body: string;
}): string {
  const title = options.title === undefined ? "" : `<title>${escapeHtml(options.title)}</title>`;
  const description = options.description === undefined
    ? ""
    : `<meta name="description" content="${escapeHtml(options.description)}">`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${title}
  ${description}
</head>
<body>
${options.body}
</body>
</html>`;
}

export class DemoSite {
  private brokenLinkFixed = false;

  get isBrokenLinkFixed(): boolean {
    return this.brokenLinkFixed;
  }

  fixBrokenLink(): { changed: boolean; message: string } {
    const changed = !this.brokenLinkFixed;
    this.brokenLinkFixed = true;
    return {
      changed,
      message: changed ? "The demo missing-page target now returns HTTP 200." : "The demo link was already fixed.",
    };
  }

  reset(): void {
    this.brokenLinkFixed = false;
  }

  handle(pathname: string): DemoResponse {
    const path = pathname.replace(/\/+$/, "") || "/";

    if (path === "/robots.txt") {
      return {
        statusCode: 200,
        contentType: "text/plain; charset=utf-8",
        body: "User-agent: *\nAllow: /\n",
      };
    }

    if (path === "/old") return this.redirect("/a");
    if (path === "/a") return this.redirect("/b");
    if (path === "/b") return this.redirect("/final");
    if (path === "/final") return this.html(htmlPage({ title: "Final destination", description: "The final redirect target.", body: "<main><h1>Final destination</h1><p>Three-hop redirect test target.</p></main>" }));

    if (path === "/missing-page") {
      return this.brokenLinkFixed
        ? this.html(htmlPage({ title: "Recovered page", description: "This page was restored for the recheck test.", body: "<main><h1>Recovered page</h1><p>The formerly missing route now works.</p></main>" }))
        : this.html("<!doctype html><html><head><title>Not found</title></head><body><h1>Page not found</h1></body></html>", 404);
    }

    if (path === "/") return this.homePage();
    if (path === "/about") return this.aboutPage();
    if (path === "/contact") return this.html(htmlPage({ title: "Contact", description: "Contact the FixLoop sample organization.", body: "<main><h1>Contact</h1><p>Contact page for the synthetic audit site.</p></main>" }));
    if (path === "/pages/no-title") {
      return this.html(htmlPage({ description: "This synthetic page intentionally has no title tag.", body: "<main><h1>Title missing</h1><p>Planted SEO issue: missing title.</p></main>" }));
    }
    if (path === "/pages/duplicate-a" || path === "/pages/duplicate-b") {
      return this.html(htmlPage({ title: "Shared duplicate title", description: "A planted duplicate-title sample.", body: `<main><h1>${path.endsWith("a") ? "Duplicate A" : "Duplicate B"}</h1><p>Planted SEO issue: duplicate title.</p></main>` }));
    }
    if (path === "/pages/missing-alt") {
      return this.html(htmlPage({ title: "Image accessibility sample", description: "A planted image alternative-text issue.", body: `<main><h1>Missing image alternative text</h1><img src="${DEMO_BASE_PATH}/assets/banner.svg"><p>The image intentionally omits its alt attribute.</p></main>` }));
    }
    if (path === "/assets/banner.svg") {
      return {
        statusCode: 200,
        contentType: "image/svg+xml; charset=utf-8",
        body: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 180\"><rect width=\"640\" height=\"180\" fill=\"#3157d5\"/><text x=\"24\" y=\"100\" fill=\"white\" font-size=\"40\">FixLoop demo</text></svg>",
      };
    }

    const pageMatch = path.match(/^\/pages\/page-(\d{1,3})$/);
    if (pageMatch) {
      const pageNumber = Number(pageMatch[1]);
      if (pageNumber >= 1 && pageNumber <= DEMO_PAGE_COUNT) {
        const next = pageNumber < DEMO_PAGE_COUNT
          ? `<a href="${DEMO_BASE_PATH}/pages/page-${pageNumber + 1}">Next synthetic page</a>`
          : "";
        return this.html(htmlPage({
          title: `Synthetic page ${pageNumber}`,
          description: `Generated page ${pageNumber} for the FixLoop page-limit test.`,
          body: `<main><h1>Synthetic page ${pageNumber}</h1><p>This page exists to make the crawl reproducible.</p>${next}</main>`,
        }));
      }
    }

    return this.html("<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>", 404);
  }

  private homePage(): DemoResponse {
    const navigation = [
      `<a href="${DEMO_BASE_PATH}/about">About</a>`,
      `<a href="${DEMO_BASE_PATH}/contact">Contact</a>`,
      `<a href="${DEMO_BASE_PATH}/old">Three-hop redirect test</a>`,
      `<a href="${DEMO_BASE_PATH}/pages/no-title">Missing title sample</a>`,
      `<a href="${DEMO_BASE_PATH}/pages/duplicate-a">Duplicate title sample A</a>`,
      `<a href="${DEMO_BASE_PATH}/pages/duplicate-b">Duplicate title sample B</a>`,
      `<a href="${DEMO_BASE_PATH}/pages/missing-alt">Missing alt sample</a>`,
    ];
    const generatedPages = Array.from({ length: DEMO_PAGE_COUNT }, (_, index) =>
      `<a href="${DEMO_BASE_PATH}/pages/page-${index + 1}">Page ${index + 1}</a>`,
    );
    return this.html(htmlPage({
      title: "FixLoop Synthetic Demo Site",
      description: "A permitted, reproducible sample website for testing FixLoop SEO crawling.",
      body: `<header><nav>${navigation.join(" | ")}</nav></header>
<main><h1>FixLoop Synthetic Demo Site</h1>
<p>This site contains deliberately planted link and SEO cases. It is safe to crawl for the hackathon demo.</p>
<section><h2>Generated pages</h2><ul>${generatedPages.map((item) => `<li>${item}</li>`).join("\n")}</ul></section>
</main>`,
    }));
  }

  private aboutPage(): DemoResponse {
    const target = `${DEMO_BASE_PATH}/missing-page`;
    const linkLabel = this.brokenLinkFixed ? "Recovered demo page" : "Planted broken link";
    return this.html(htmlPage({
      title: "About FixLoop Demo",
      description: "About page containing the controlled broken-link test.",
      body: `<header><nav><a href="${DEMO_BASE_PATH}/">Home</a> | <a href="${DEMO_BASE_PATH}/contact">Contact</a></nav></header>
<main><h1>About</h1><p>The link below is broken until the test toggle is activated.</p><a href="${target}">${linkLabel}</a></main>`,
    }));
  }

  private redirect(path: string): DemoResponse {
    return {
      statusCode: 302,
      contentType: "text/plain; charset=utf-8",
      body: `Redirecting to ${DEMO_BASE_PATH}${path}`,
      headers: { Location: `${DEMO_BASE_PATH}${path}` },
    };
  }

  private html(body: string, statusCode = 200): DemoResponse {
    return { statusCode, contentType: "text/html; charset=utf-8", body };
  }
}

export function createDemoSite(): DemoSite {
  return new DemoSite();
}
