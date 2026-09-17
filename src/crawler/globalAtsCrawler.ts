import { chromium } from "playwright";
import { CrawlerJob } from "./types";
import { db } from "../db/db";
import { companies } from "../db/schema";
import { eq } from "drizzle-orm";

// Composite queries — same coverage, 4 searches instead of 17 per platform
const ATS_KEYWORD_GROUPS = [
  '"software engineer" OR "full stack developer" OR "backend developer" OR "sde"',
  '"frontend developer" OR "react developer" OR "node.js developer" OR "python developer"',
  '"product manager" OR "product analyst" OR "data analyst" OR "operations associate"',
  '"fresher" OR "walk-in" OR "process associate" OR "non-voice"',
];

export async function crawlGlobalATS(keywords?: string[], location: string = "India"): Promise<CrawlerJob[]> {
  const keywordGroups = ATS_KEYWORD_GROUPS;
  console.log(`[Global ATS] Starting discovery: ${keywordGroups.length} keyword groups × 3 platforms = ${keywordGroups.length * 3} searches (optimized from 51)...`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const jobsList: CrawlerJob[] = [];
  const seenUrls = new Set<string>();
  const platforms = [
    { type: "greenhouse", site: "boards.greenhouse.io" },
    { type: "lever", site: "jobs.lever.co" },
    { type: "ashby", site: "jobs.ashbyhq.com" }
  ];

  try {
    const page = await context.newPage();
    
    for (const keyword of keywordGroups) {
      for (const platform of platforms) {
        // Search DuckDuckGo HTML version for the ATS site + keyword + location
        const query = `site:${platform.site} ${keyword} ${location}`;
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        console.log(`[Global ATS] Searching: ${keyword.substring(0, 50)}... on ${platform.type}`);
        
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        
        // Wait for results
        try {
          await page.waitForSelector(".result__url", { timeout: 8000 });
        } catch (e) {
          console.log(`[Global ATS] No results for "${keyword.substring(0, 30)}..." on ${platform.type}`);
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
              const urlParts = cleanUrl.split("/");
              const companyName = urlParts[3]; // 0: https:, 1: empty, 2: domain, 3: companyName

              if (companyName && companyName !== "jobs" && companyName !== "postings" && !seenUrls.has(cleanUrl)) {
                seenUrls.add(cleanUrl);
                jobsList.push({
                  title: `${keyword.substring(1, keyword.indexOf('"', 1))} (Discovered)`,
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
        
        // Faster delay — still polite to DDG
        await page.waitForTimeout(800 + Math.random() * 800);
      }
    }
  } catch (error) {
    console.error("[Global ATS] Main crawl error:", error);
  } finally {
    await browser.close();
  }

  console.log(`[Global ATS] Found ${jobsList.length} unique globally discovered ATS jobs.`);
  return jobsList;
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
