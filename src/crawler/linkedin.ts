import { chromium } from "playwright";
import { CrawlerJob } from "./types";
import dotenv from "dotenv";

dotenv.config();

export async function crawlLinkedIn(keywords: string[], locations: string | string[] = "India"): Promise<CrawlerJob[]> {
  const locList = Array.isArray(locations) ? locations : [locations];
  console.log(`[LinkedIn] Crawling jobs for keywords: [${keywords.join(", ")}] across locations: [${locList.join(", ")}]...`);
  
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
    
    for (const loc of locList) {
      for (const keyword of keywords) {
        // sortBy=DD ensures strictly latest posted jobs, f_TPR=r86400 restricts to past 24 hours
        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(loc)}&sortBy=DD&f_TPR=r86400`;
        console.log(`[LinkedIn] Searching latest jobs: ${searchUrl}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        // Wait for job cards
        try {
          await page.waitForSelector(".job-search-card, .jobs-search__results-list li", { timeout: 10000 });
        } catch (e) {
          console.log(`[LinkedIn] No jobs found or selector not visible for keyword "${keyword}" in ${loc}`);
          continue;
        }

        // Extract card elements
        const cards = await page.$$(".job-search-card, .jobs-search__results-list li");
        console.log(`[LinkedIn] Found ${cards.length} cards for keyword "${keyword}" in ${loc}`);

        // Maximize accurate crawl capacity: take up to 25 fresh cards per keyword
        for (const card of cards.slice(0, 25)) {
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
  }

    // Now navigate to each job to get full description
    console.log(`[LinkedIn] Fetching details for ${jobsList.length} jobs...`);
    for (const job of jobsList) {
      try {
        await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        
        // Try multiple selectors for description
        let desc = "";
        const descSelectors = [
          ".show-more-less-html__markup",
          ".jobs-description__content",
          ".job-view-layout-post-description",
          "article.jobs-description__container",
          ".description__text",
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
        // Polite delay to prevent IP blocking while staying fast
        await page.waitForTimeout(400 + Math.random() * 400);
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

export async function crawlLinkedInPosts(keywords: string[], locations: string | string[] = "India"): Promise<CrawlerJob[]> {
  const locList = Array.isArray(locations) ? locations : [locations];
  console.log(`[LinkedIn] Crawling POSTS for keywords: [${keywords.join(", ")}] across locations: [${locList.join(", ")}]...`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  if (process.env.LINKEDIN_COOKIE) {
    await context.addCookies([{ name: "li_at", value: process.env.LINKEDIN_COOKIE, domain: ".linkedin.com", path: "/" }]);
  } else {
    console.log("[LinkedIn] Warning: Crawling posts generally requires authentication (LINKEDIN_COOKIE).");
  }

  const postsList: CrawlerJob[] = [];
  try {
    const page = await context.newPage();
    for (const loc of locList) {
      for (const keyword of keywords) {
        // Construct search query for posts
        const searchQuery = `${keyword} ${loc}`;
        // datePosted="past-24h"
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(searchQuery)}&datePosted=%22past-24h%22&sortBy=%22date_posted%22`;
        console.log(`[LinkedIn] Searching latest posts: ${searchUrl}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        try {
          await page.waitForSelector(".search-results-container, .feed-shared-update-v2", { timeout: 10000 });
        } catch (e) {
          console.log(`[LinkedIn] No posts found or selector not visible for keyword "${keyword}" in ${loc}`);
          continue;
        }

        await page.waitForTimeout(2000); // Allow feed to render

        const posts = await page.$$(".feed-shared-update-v2, .search-results-container ul > li");
        console.log(`[LinkedIn] Found ${posts.length} posts for keyword "${keyword}" in ${loc}`);

        for (const post of posts.slice(0, 15)) {
          try {
            const authorEl = await post.$(".update-components-actor__name, .app-aware-link span[dir='ltr']");
            const textEl = await post.$(".update-components-text, .feed-shared-update-v2__description");
            const linkEl = await post.$(".update-components-actor__meta-link, a.app-aware-link");

            let author = "Unknown Member";
            if (authorEl) author = (await authorEl.innerText()).trim();

            let text = "";
            if (textEl) text = (await textEl.innerText()).trim();

            let url = searchUrl; // Fallback
            if (linkEl) {
              const href = await linkEl.getAttribute("href");
              if (href) {
                try {
                  const urlObj = new URL(href, "https://www.linkedin.com");
                  url = `${urlObj.origin}${urlObj.pathname}`;
                } catch (e) {
                  url = href;
                }
              }
            }

            // Only add if there is meaningful text
            if (text) {
              postsList.push({
                title: `Walk-in Post by ${author.split("\\n")[0]}`,
                companyName: author.split("\\n")[0],
                url,
                description: text,
                location: loc,
                postedAt: new Date(),
              });
            }
          } catch (postErr) {
            console.error("[LinkedIn] Error parsing post:", postErr);
          }
        }
      }
    }
  } catch (error) {
    console.error("[LinkedIn] Main post crawl error:", error);
  } finally {
    await browser.close();
  }

  return postsList;
}
