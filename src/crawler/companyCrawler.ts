import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";
import { chromium } from "playwright";

export class CompanyCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    console.log(`[Custom Scraper] Crawling custom career page for ${this.companyName} at: ${this.boardToken}...`);
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const jobs: CrawlerJob[] = [];

    try {
      const page = await context.newPage();
      await page.goto(this.boardToken, { waitUntil: "domcontentloaded", timeout: 45000 });

      // Scan all anchor links on the page
      const anchors = await page.$$("a");
      console.log(`[Custom Scraper] Found ${anchors.length} links on careers page of ${this.companyName}`);

      for (const a of anchors) {
        try {
          const href = await a.getAttribute("href");
          const text = (await a.innerText()).trim();

          if (href && text) {
            const absoluteUrl = new URL(href, this.boardToken).toString();
            const lowerText = text.toLowerCase();
            const lowerHref = href.toLowerCase();

            // Simple heuristic filter to find actual job listing URLs
            const isJobUrl = lowerHref.includes("/job/") || lowerHref.includes("/jobs/") || lowerHref.includes("/careers/") || lowerHref.includes("/position/");
            const isRoleTitle = lowerText.includes("engineer") || lowerText.includes("developer") || lowerText.includes("designer") || lowerText.includes("product") || lowerText.includes("sde");

            if (isJobUrl && isRoleTitle && jobs.length < 20) {
              // Deduplicate
              if (!jobs.some(j => j.url === absoluteUrl)) {
                jobs.push({
                  title: text,
                  companyName: this.companyName,
                  url: absoluteUrl,
                  description: `Custom scraped job listing from ${this.companyName} careers site.`,
                  location: "Remote/Hybrid",
                  postedAt: new Date(),
                });
              }
            }
          }
        } catch (elErr) {}
      }
    } catch (err) {
      console.error(`[Custom Scraper] Crawl failed for ${this.companyName}:`, err);
    } finally {
      await browser.close();
    }

    return jobs;
  }
}
