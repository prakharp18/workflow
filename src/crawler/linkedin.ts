import { chromium, Page } from "playwright";
import { CrawlerJob } from "./types";
import dotenv from "dotenv";

dotenv.config();

// Composite OR-queries — same coverage, 5 searches instead of 17
const LINKEDIN_KEYWORD_GROUPS = [
  '"software engineer" OR "full stack developer" OR "backend developer"',
  '"sde" OR "sde-1" OR "frontend developer" OR "react developer"',
  '"associate product manager" OR "product analyst" OR "data analyst"',
  '"process associate" OR "operations associate" OR "non-voice"',
  '"fresher" OR "walk-in" OR "mega walk-in"',
];

// Reduced locations — LinkedIn geo-search covers surrounding cities
const LINKEDIN_LOCATIONS = [
  "India",
  "Delhi NCR, India",
  "Bengaluru, Karnataka, India",
];

export async function crawlLinkedIn(keywords?: string[], locations?: string | string[]): Promise<CrawlerJob[]> {
  // Use optimized defaults; ignore passed-in keywords/locations for speed
  const keywordGroups = LINKEDIN_KEYWORD_GROUPS;
  const locList = LINKEDIN_LOCATIONS;

  console.log(`[LinkedIn] Crawling jobs: ${keywordGroups.length} keyword groups × ${locList.length} locations = ${keywordGroups.length * locList.length} searches (optimized from 119)...`);
  
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
  const seenUrls = new Set<string>();

  try {
    const page = await context.newPage();
    
    for (const loc of locList) {
      for (const keyword of keywordGroups) {
        // sortBy=DD ensures strictly latest posted jobs, f_TPR=r86400 restricts to past 24 hours
        const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(loc)}&sortBy=DD&f_TPR=r86400`;
        console.log(`[LinkedIn] Searching: ${keyword.substring(0, 50)}... in ${loc}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        // Wait for job cards
        try {
          await page.waitForSelector(".job-search-card, .jobs-search__results-list li", { timeout: 8000 });
        } catch (e) {
          console.log(`[LinkedIn] No results for "${keyword.substring(0, 30)}..." in ${loc}`);
          continue;
        }

        // Extract card elements
        const cards = await page.$$(".job-search-card, .jobs-search__results-list li");
        console.log(`[LinkedIn] Found ${cards.length} cards`);

        // Take up to 25 fresh cards per keyword group
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

            // Dedup by URL
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              jobsList.push({
                title,
                companyName,
                url,
                description: "", // Fetched selectively below
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

    // Selective description fetching: only for jobs that pass basic title pre-filter
    // Import pre-filter logic inline to avoid circular deps
    const IGNORE_TITLES = ["senior", "staff", "principal", "lead", "director", "vp", "head of", "architect", "sr.", "sr ", "sde 3", "sde-3", "sde iii", "sde-iii", "sde 2", "sde-2", "sde ii", "sde-ii", "lead engineer", "engineering manager"];
    
    const filteredJobs = jobsList.filter(job => {
      const lower = job.title.toLowerCase();
      for (const kw of IGNORE_TITLES) {
        if (lower.includes(kw) && !lower.includes("intern")) return false;
      }
      return true;
    });

    console.log(`[LinkedIn] Fetching descriptions for ${filteredJobs.length}/${jobsList.length} pre-filtered jobs (skipping ${jobsList.length - filteredJobs.length} senior/lead roles)...`);

    // Batch description fetch with concurrency limit of 3
    const CONCURRENCY = 3;
    for (let i = 0; i < filteredJobs.length; i += CONCURRENCY) {
      const batch = filteredJobs.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (job) => {
        try {
          const descPage = await context.newPage();
          await descPage.goto(job.url, { waitUntil: "domcontentloaded", timeout: 12000 });
          
          const descSelectors = [
            ".show-more-less-html__markup",
            ".jobs-description__content",
            ".job-view-layout-post-description",
            "article.jobs-description__container",
            ".description__text",
          ];
          
          let desc = "";
          for (const selector of descSelectors) {
            try {
              const element = await descPage.$(selector);
              if (element) {
                desc = (await element.innerText()).trim();
                if (desc) break;
              }
            } catch (_) {}
          }
          
          job.description = desc || "No description available";
          await descPage.close();
        } catch (jobErr) {
          job.description = "Fetch failed";
        }
      }));
    }

  } catch (error) {
    console.error("[LinkedIn] Main crawl error:", error);
  } finally {
    await browser.close();
  }

  // Filter out any jobs where we failed to scrape descriptions
  return jobsList.filter(job => job.description && job.description !== "Fetch failed");
}

export async function crawlLinkedInPosts(keywords?: string[], locations?: string | string[]): Promise<CrawlerJob[]> {
  // Optimized: 3 keywords × 1 broad location = 3 page loads (down from 21)
  const postKeywords = ["walk-in drive", "mega walk-in hiring", "walkin fresher"];
  const locList = ["India"];

  console.log(`[LinkedIn] Crawling POSTS: ${postKeywords.length} keywords × ${locList.length} locations = ${postKeywords.length * locList.length} searches (optimized from 21)...`);
  
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
  const seenPostUrls = new Set<string>();

  try {
    const page = await context.newPage();
    for (const loc of locList) {
      for (const keyword of postKeywords) {
        // Construct search query for posts
        const searchQuery = `${keyword} ${loc}`;
        // datePosted="past-24h"
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(searchQuery)}&datePosted=%22past-24h%22&sortBy=%22date_posted%22`;
        console.log(`[LinkedIn] Searching posts: ${keyword}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        try {
          await page.waitForSelector(".search-results-container, .feed-shared-update-v2", { timeout: 8000 });
        } catch (e) {
          console.log(`[LinkedIn] No posts found for "${keyword}"`);
          continue;
        }

        await page.waitForTimeout(800); // Reduced from 2000ms

        const posts = await page.$$(".feed-shared-update-v2, .search-results-container ul > li");
        console.log(`[LinkedIn] Found ${posts.length} posts for "${keyword}"`);

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

            // Only add if there is meaningful text and not duplicate
            if (text && !seenPostUrls.has(url)) {
              seenPostUrls.add(url);
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
