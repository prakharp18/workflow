import { CrawlerJob } from "./types";

export interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    metadata?: {
      title?: string;
      description?: string;
      ogTitle?: string;
      [key: string]: any;
    };
  };
  error?: string;
}

export interface FirecrawlMapResponse {
  success: boolean;
  links?: string[];
  error?: string;
}

const FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v1";

/**
 * Scrape a single URL using Firecrawl API to retrieve clean LLM-ready markdown.
 */
export async function scrapeUrlWithFirecrawl(url: string): Promise<FirecrawlScrapeResponse> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { success: false, error: "FIRECRAWL_API_KEY is not configured in environment." };
  }

  try {
    const res = await fetch(`${FIRECRAWL_API_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Firecrawl HTTP error ${res.status}: ${errText}` };
    }

    const json = (await res.json()) as any;
    return {
      success: true,
      data: {
        markdown: json.data?.markdown || "",
        links: json.data?.links || [],
        metadata: json.data?.metadata || {},
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Map/Discover all job URLs on a company's career portal using Firecrawl Map API.
 */
export async function mapCompanyWithFirecrawl(baseUrl: string): Promise<string[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  try {
    console.log(`[Firecrawl] Mapping job URLs on: ${baseUrl}...`);
    const res = await fetch(`${FIRECRAWL_API_BASE}/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: baseUrl,
        search: "job engineer developer career position role sde",
        limit: 50,
      }),
    });

    if (!res.ok) {
      console.warn(`[Firecrawl] Map request failed (${res.status}). Falling back...`);
      return [];
    }

    const json = (await res.json()) as FirecrawlMapResponse;
    const links = json.links || [];

    // Filter links matching job patterns
    const jobLinks = links.filter((link) => {
      const lower = link.toLowerCase();
      return (
        lower.includes("/job/") ||
        lower.includes("/jobs/") ||
        lower.includes("/careers/") ||
        lower.includes("/position/") ||
        lower.includes("/role/") ||
        lower.includes("/opening/")
      );
    });

    console.log(`[Firecrawl] Discovered ${jobLinks.length} candidate job URLs.`);
    return jobLinks;
  } catch (err) {
    console.error("[Firecrawl] Error during site mapping:", err);
    return [];
  }
}

/**
 * Crawl a company career page with high accuracy using Firecrawl.
 */
export async function crawlCompanyWithFirecrawl(baseUrl: string, companyName: string): Promise<CrawlerJob[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.log("[Firecrawl] FIRECRAWL_API_KEY not set. Skipping Firecrawl engine.");
    return [];
  }

  console.log(`[Firecrawl] Crawling custom career page for ${companyName} (${baseUrl})...`);
  const jobs: CrawlerJob[] = [];

  // Step 1: Map job links
  let jobUrls = await mapCompanyWithFirecrawl(baseUrl);

  // Fallback: If map returned no filtered links, try scraping the main page for links
  if (jobUrls.length === 0) {
    const mainScrape = await scrapeUrlWithFirecrawl(baseUrl);
    if (mainScrape.success && mainScrape.data?.links) {
      jobUrls = mainScrape.data.links.filter((l) => {
        const lower = l.toLowerCase();
        return (
          lower.includes("/job/") ||
          lower.includes("/jobs/") ||
          lower.includes("/careers/") ||
          lower.includes("/position/") ||
          lower.includes("/role/")
        );
      });
    }
  }

  // Limit to max 15 jobs per company to keep execution fast and respect API rates
  const targetUrls = jobUrls.slice(0, 15);

  // Step 2: Scrape each job URL for clean Markdown description
  for (const url of targetUrls) {
    const scraped = await scrapeUrlWithFirecrawl(url);
    if (scraped.success && scraped.data) {
      const title =
        scraped.data.metadata?.title?.split("|")[0]?.split("-")[0]?.trim() ||
        scraped.data.metadata?.ogTitle ||
        "Software Engineering Role";

      jobs.push({
        title,
        companyName,
        url,
        description: scraped.data.markdown || scraped.data.metadata?.description || "",
        location: "Remote/Hybrid",
        postedAt: new Date(),
      });
    }
  }

  console.log(`[Firecrawl] Successfully scraped ${jobs.length} high-accuracy job listings for ${companyName}.`);
  return jobs;
}
