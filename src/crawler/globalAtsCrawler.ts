import { chromium } from "playwright";
import { CrawlerJob } from "./types";
import { db } from "../db/db";
import { companies } from "../db/schema";
import { eq } from "drizzle-orm";

export async function crawlGlobalATS(keywords: string[], location: string = "India"): Promise<CrawlerJob[]> {
  console.log(`[Global ATS] Starting autonomous discovery for keywords: [${keywords.join(", ")}] in ${location}...`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const jobsList: CrawlerJob[] = [];
  const platforms = [
    { type: "greenhouse", site: "boards.greenhouse.io" },
    { type: "lever", site: "jobs.lever.co" },
    { type: "ashby", site: "jobs.ashbyhq.com" }
  ];

  try {
    const page = await context.newPage();
    
    for (const keyword of keywords) {
      for (const platform of platforms) {
        // Search DuckDuckGo HTML version for the ATS site + keyword + location
        const query = `site:${platform.site} "${keyword}" ${location}`;
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        console.log(`[Global ATS] Searching: ${query}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        
        // Wait for results
        try {
          await page.waitForSelector(".result__url", { timeout: 10000 });
        } catch (e) {
          console.log(`[Global ATS] No results found or DDG rate limit for query "${query}"`);
          continue;
        }

        const resultLinks = await page.$$(".result__url");
        
        for (const linkEl of resultLinks) {
          try {
            const urlText = (await linkEl.innerText()).trim();
            // DuckDuckGo displays URLs like: boards.greenhouse.io/companyname/jobs/12345
            if (urlText.includes(platform.site) && (urlText.includes("jobs/") || urlText.includes("postings/"))) {
              // Clean up the URL to actual https form
              let cleanUrl = "https://" + urlText.replace(/\s/g, "");
              
              // Extract company name
              // Greenhouse: boards.greenhouse.io/companyname/...
              // Lever: jobs.lever.co/companyname/...
              // Ashby: jobs.ashbyhq.com/companyname/...
              const urlParts = cleanUrl.split("/");
              const companyName = urlParts[3]; // 0: https:, 1: empty, 2: domain, 3: companyName

              if (companyName && companyName !== "jobs" && companyName !== "postings") {
                jobsList.push({
                  title: `${keyword} (Discovered)`, // Will be enriched later or just passed to AI
                  companyName: companyName,
                  url: cleanUrl,
                  description: "Global ATS Discovered Job",
                  location: location,
                  postedAt: new Date(),
                });

                // AUTONOMOUS EXPANSION: Add company to DB if it doesn't exist
                await autonomouslyAddCompany(companyName, platform.type, platform.site);
              }
            }
          } catch (err) {
            console.error("[Global ATS] Error parsing search result link:", err);
          }
        }
        
        // Be nice to DDG
        await page.waitForTimeout(2000 + Math.random() * 2000);
      }
    }
  } catch (error) {
    console.error("[Global ATS] Main crawl error:", error);
  } finally {
    await browser.close();
  }

  // Deduplicate discovered jobs by URL
  const uniqueJobs = Array.from(new Map(jobsList.map(j => [j.url, j])).values());
  console.log(`[Global ATS] Found ${uniqueJobs.length} unique globally discovered ATS jobs.`);
  
  return uniqueJobs;
}

// Helper function to autonomously expand the monitored company database
async function autonomouslyAddCompany(companyName: string, atsType: string, atsDomain: string) {
  try {
    const existing = await db.query.companies.findFirst({
      where: eq(companies.name, companyName),
    });

    if (!existing) {
      console.log(`[Autonomous Expansion] Discovered new company: "${companyName}". Adding to database for future monitoring...`);
      await db.insert(companies).values({
        name: companyName,
        atsType: atsType,
        atsUrl: companyName,
        website: `https://${atsDomain}/${companyName}`,
        isMonitored: true,
      });
    }
  } catch (err) {
    console.error(`[Autonomous Expansion] Failed to insert company "${companyName}":`, err);
  }
}
