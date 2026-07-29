import { chromium } from "playwright";
import { CrawlerJob } from "./types";
import dotenv from "dotenv";

dotenv.config();

export async function crawlLinkedIn(keywords: string[], location: string = "India"): Promise<CrawlerJob[]> {
  console.log(`[LinkedIn] Crawling jobs for keywords: [${keywords.join(", ")}] in ${location}...`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  if (process.env.LINKEDIN_COOKIE) {
    console.log("[LinkedIn] Setting session cookie...");
    await context.addCookies([
      {
        name: "li_at",
        value: process.env.LINKEDIN_COOKIE,
        domain: ".linkedin.com",
        path: "/",
      },
    ]);
  }

  const jobsList: CrawlerJob[] = [];

  try {
    const page = await context.newPage();
    
    for (const keyword of keywords) {
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&f_TPR=r86400`; // Posted within last 24 hours
      console.log(`[LinkedIn] Searching: ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      
      // Wait for job cards
      try {
        await page.waitForSelector(".job-search-card, .jobs-search__results-list li", { timeout: 10000 });
      } catch (e) {
        console.log(`[LinkedIn] No jobs found or selector not visible for keyword "${keyword}"`);
        continue;
      }

      // Extract card elements
      const cards = await page.$$(".job-search-card, .jobs-search__results-list li");
      console.log(`[LinkedIn] Found ${cards.length} cards for keyword "${keyword}"`);

      // Limit to first 10 for test/rate limit safety
      for (const card of cards.slice(0, 10)) {
        try {
          const titleEl = await card.$(".base-search-card__title, .job-card-list__title");
          const companyEl = await card.$(".base-search-card__subtitle, .job-card-container__company-name");
          const linkEl = await card.$("a.base-card__full-link, a.job-card-list__title");
          const locationEl = await card.$(".job-search-card__metadata, .job-card-container__metadata-item");

          if (titleEl && companyEl && linkEl) {
            const title = (await titleEl.innerText()).trim();
            const companyName = (await companyEl.innerText()).trim();
            let url = (await linkEl.getAttribute("href")) || "";
            // Clean up the URL to prevent tracking params
            const urlObj = new URL(url);
            url = `${urlObj.origin}${urlObj.pathname}`;
            
            const locationStr = locationEl ? (await locationEl.innerText()).trim() : "India";

            // If it's a valid link, push to processing list
            if (url) {
              jobsList.push({
                title,
                companyName,
                url,
                description: "", // Fetched on detailed page visit
                location: locationStr,
                postedAt: new Date(),
              });
            }
          }
        } catch (cardErr) {
          console.error("[LinkedIn] Error parsing job card:", cardErr);
        }
      }
    }

    // Now navigate to each job to get full description
    console.log(`[LinkedIn] Fetching details for ${jobsList.length} jobs...`);
    for (const job of jobsList) {
      try {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        // Try multiple selectors for description
        let desc = "";
        const descSelectors = [
          ".show-more-less-html__markup",
          ".jobs-description__content",
          ".job-view-layout-post-description",
          "article.jobs-description__container",
        ];
        
        for (const selector of descSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              desc = (await element.innerText()).trim();
              if (desc) break;
            }
          } catch (_) {}
        }
        
        job.description = desc || "No description available";
        // Artificial delay to prevent block
        await page.waitForTimeout(1000 + Math.random() * 1000);
      } catch (jobErr) {
        console.error(`[LinkedIn] Error fetching details for ${job.url}:`, jobErr);
        job.description = "Fetch failed";
      }
    }

  } catch (error) {
    console.error("[LinkedIn] Main crawl error:", error);
  } finally {
    await browser.close();
  }

  // Filter out any jobs where we failed to scrape descriptions
  return jobsList.filter(job => job.description && job.description !== "Fetch failed");
}
