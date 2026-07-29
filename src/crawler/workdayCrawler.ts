import { BaseCrawler } from "./baseCrawler";
import { CrawlerJob } from "./types";
import { chromium } from "playwright";

export class WorkdayCrawler extends BaseCrawler {
  async crawl(): Promise<CrawlerJob[]> {
    console.log(`[Workday] Crawling ${this.companyName} at token/URL: ${this.boardToken}...`);
    
    // The boardToken can be the full subdomain/career page token or URL
    // e.g. "https://stripe.myworkdayjobs.com/en-US/stripe_careers"
    let url = this.boardToken;
    if (!url.startsWith("http")) {
      url = `https://${this.boardToken}.myworkdayjobs.com/en-US/Careers`;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const crawledJobs: CrawlerJob[] = [];

    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

      // Workday typically uses data-automation-id="jobTitle" or data-automation-id="searchResultItem"
      try {
        await page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 15000 });
      } catch (e) {
        console.log(`[Workday] Timeout waiting for job elements at ${url}`);
        await browser.close();
        return [];
      }

      const jobElements = await page.$$('[data-automation-id="jobTitle"]');
      console.log(`[Workday] Found ${jobElements.length} job elements for ${this.companyName}`);

      for (const el of jobElements) {
        try {
          const title = (await el.innerText()).trim();
          const href = await el.getAttribute("href");
          
          if (title && href) {
            const absoluteUrl = new URL(href, url).toString();
            crawledJobs.push({
              title,
              companyName: this.companyName,
              url: absoluteUrl,
              description: "Workday Job - click apply link to view details", // Workday descriptions require separate page load
              location: "Remote/Hybrid",
              postedAt: new Date(),
            });
          }
        } catch (itemErr) {
          console.error("[Workday] Error parsing job item:", itemErr);
        }
      }
    } catch (err) {
      console.error(`[Workday] Crawl failed for ${this.companyName}:`, err);
    } finally {
      await browser.close();
    }

    return crawledJobs;
  }
}
