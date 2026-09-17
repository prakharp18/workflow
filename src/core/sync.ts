import { db } from "../db/db";
import { companies, jobs, jobMatches, resumeProfile, recruiters, eventsTimeline, historicalSnapshots } from "../db/schema";
import { eq, isNull, desc, inArray } from "drizzle-orm";
import { crawlLinkedIn, crawlLinkedInPosts } from "../crawler/linkedin";
import { crawlGlobalATS } from "../crawler/globalAtsCrawler";
import { crawlRemoteOK, crawlYCJobs } from "../crawler/rssCrawlers";
import { getCrawler } from "../crawler/crawlerRegistry";
import { evaluateJob } from "./matcher";
import { parseResume, generateOutreach } from "./geminiService";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { runCompanyDiscovery } from "./discoveryAgent";

export async function runJobSync() {
  const syncStart = Date.now();
  console.log("[Sync] Starting global A-to-Z jobs synchronization...");

  // 1. Run Company Discovery first (Phase A)
  try {
    console.log("[Sync] Phase A: Discovering new startups & companies...");
    await runCompanyDiscovery();
  } catch (discoveryErr) {
    console.error("[Sync] Company discovery failed, proceeding with sync:", discoveryErr);
  }

  // 2. Scan and parse resume.txt if exists and updated (Phase B)
  try {
    const resumePath = path.resolve(process.cwd(), "resume.txt");
    if (fs.existsSync(resumePath)) {
      console.log(`[Sync] Phase B: Found resume.txt at ${resumePath}. Checking for updates...`);
      const resumeText = fs.readFileSync(resumePath, "utf-8");
      const activeResume = await db.query.resumeProfile.findFirst({
        orderBy: (rp, { desc }) => [desc(rp.createdAt)],
      });

      if (!activeResume || activeResume.rawText !== resumeText) {
        console.log("[Sync] New or updated resume.txt detected. Parsing with Gemini AI...");
        const parsed = await parseResume(resumeText);
        await db.insert(resumeProfile).values({
          parsedJson: parsed,
          rawText: resumeText,
        });
        console.log(`[Sync] Successfully loaded and parsed resume for candidate: ${parsed.name}`);
      } else {
        console.log("[Sync] Resume has not changed. Skipping parsing to save API quota.");
      }
    } else {
      console.log("[Sync] Phase B: No local resume.txt found. Using existing profile if available.");
    }
  } catch (resumeErr) {
    console.error("[Sync] Resume parsing/sync failed, proceeding with sync:", resumeErr);
  }

  console.log("[Sync] Phase C: Fetching monitored companies for crawling...");
  // 3. Fetch monitored companies
  const monitoredCompanies = await db.query.companies.findMany({
    where: eq(companies.isMonitored, true),
  });
  
  console.log(`[Sync] Found ${monitoredCompanies.length} monitored companies.`);
  
  const allCrawledJobs: any[] = [];

  // 2. Crawl ATS platforms dynamically based on scheduling interval (capped to 15 companies per run)
  const MAX_COMPANIES_PER_RUN = 15;
  let crawledCompaniesCount = 0;

  for (const comp of monitoredCompanies) {
    if (crawledCompaniesCount >= MAX_COMPANIES_PER_RUN) {
      console.log(`[Sync] Reached max company crawl budget (${MAX_COMPANIES_PER_RUN}) for this run. Moving to parallel crawl phase...`);
      break;
    }

    const effectivePrio = calculateEffectivePriority(comp);
    const intervalMins = getCrawlIntervalMinutes(effectivePrio);
    
    let isDue = true;
    if (comp.lastCrawledAt) {
      const lastCrawled = new Date(comp.lastCrawledAt).getTime();
      const elapsedMins = (Date.now() - lastCrawled) / (1000 * 60);
      isDue = elapsedMins >= intervalMins;
    }
    
    if (!isDue) {
      continue;
    }

    try {
      const crawler = getCrawler(comp.atsType || "custom", comp.atsUrl || comp.website || "", comp.name);
      let crawled = await crawler.crawl();
      
      // Update last crawled timestamp in DB
      await db.update(companies)
        .set({ lastCrawledAt: new Date().toISOString() })
        .where(eq(companies.id, comp.id));

      // Associate company ID
      crawled = crawled.map(j => ({ ...j, companyId: comp.id }));
      allCrawledJobs.push(...crawled);
      crawledCompaniesCount++;
    } catch (err) {
      console.error(`[Sync] Error crawling company ${comp.name}:`, err);
    }
  }

  // 3. PARALLEL CRAWL — Run LinkedIn, Posts, Global ATS, RemoteOK, YC all concurrently
  console.log("[Sync] Phase D: Running all external crawlers in PARALLEL...");
  const parallelStart = Date.now();

  const [linkedInResult, postsResult, globalAtsResult, remoteOkResult, ycResult] = await Promise.allSettled([
    crawlLinkedIn(),
    crawlLinkedInPosts(),
    crawlGlobalATS(),
    crawlRemoteOK(),
    crawlYCJobs(),
  ]);

  // Collect results from settled promises
  if (linkedInResult.status === "fulfilled") {
    allCrawledJobs.push(...linkedInResult.value);
  } else {
    console.error("[Sync] LinkedIn crawl failed:", linkedInResult.reason);
  }

  if (postsResult.status === "fulfilled") {
    allCrawledJobs.push(...postsResult.value);
  } else {
    console.error("[Sync] LinkedIn posts crawl failed:", postsResult.reason);
  }

  if (globalAtsResult.status === "fulfilled") {
    allCrawledJobs.push(...globalAtsResult.value);
  } else {
    console.error("[Sync] Global ATS crawl failed:", globalAtsResult.reason);
  }

  if (remoteOkResult.status === "fulfilled") {
    allCrawledJobs.push(...remoteOkResult.value);
  } else {
    console.error("[Sync] RemoteOK crawl failed:", remoteOkResult.reason);
  }

  if (ycResult.status === "fulfilled") {
    allCrawledJobs.push(...ycResult.value);
  } else {
    console.error("[Sync] YC Jobs crawl failed:", ycResult.reason);
  }

  const parallelElapsed = ((Date.now() - parallelStart) / 1000).toFixed(1);
  console.log(`[Sync] Parallel crawl phase completed in ${parallelElapsed}s. Total: ${allCrawledJobs.length} jobs.`);
  
  let newJobsCount = 0;

  // 4. BATCH DEDUP — Fetch all existing hashes in one query instead of N queries
  const allHashes = allCrawledJobs.map(j => 
    crypto.createHash("md5").update(j.url).digest("hex")
  );

  // Batch fetch in chunks of 500 to avoid SQL parameter limits
  const existingHashSet = new Set<string>();
  const HASH_BATCH_SIZE = 500;
  for (let i = 0; i < allHashes.length; i += HASH_BATCH_SIZE) {
    const batch = allHashes.slice(i, i + HASH_BATCH_SIZE);
    const existingBatch = await db
      .select({ hash: jobs.hash })
      .from(jobs)
      .where(inArray(jobs.hash, batch));
    for (const row of existingBatch) {
      if (row.hash) existingHashSet.add(row.hash);
    }
  }

  console.log(`[Sync] Batch dedup: ${existingHashSet.size} existing hashes found. Inserting new jobs...`);

  for (let idx = 0; idx < allCrawledJobs.length; idx++) {
    const jobData = allCrawledJobs[idx];
    const hash = allHashes[idx];
    
    if (existingHashSet.has(hash)) continue;
    if (!jobData.title) continue;

    try {
      await db.insert(jobs).values({
        companyId: jobData.companyId || null,
        title: jobData.title,
        url: jobData.url,
        description: jobData.description,
        location: jobData.location || "Remote",
        salary: jobData.salary || null,
        hash,
        postedAt: jobData.postedAt ? new Date(jobData.postedAt).toISOString() : new Date().toISOString(),
        rawJson: jobData.rawJson || null,
        applicantCount: jobData.applicantCount || null,
      });
      existingHashSet.add(hash); // Prevent duplicates within same batch
      newJobsCount++;
    } catch (err) {
      console.error(`[Sync] Failed to save job "${jobData.title}":`, err);
    }
  }

  console.log(`[Sync] Saved ${newJobsCount} new jobs.`);
  
  // 5. Automatically evaluate new/unmatched jobs against active resume
  await runMatchEvaluation();

  const totalElapsed = ((Date.now() - syncStart) / 1000 / 60).toFixed(1);
  console.log(`[Sync] ✅ Full sync completed in ${totalElapsed} minutes.`);
}

export async function runMatchEvaluation() {
  console.log("[Evaluation] Checking for unmatched jobs...");
  
  // Get active resume
  const activeResume = await db.query.resumeProfile.findFirst({
    orderBy: (rp, { desc }) => [desc(rp.createdAt)],
  });

  if (!activeResume) {
    console.log("[Evaluation] No resume uploaded yet. Use 'jobs scan' first.");
    return;
  }

  // Find jobs that don't have an entry in jobMatches (newest first)
  const unmatchedJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      url: jobs.url,
      companyId: jobs.companyId,
      location: jobs.location,
      salary: jobs.salary,
      postedAt: jobs.postedAt,
      applicantCount: jobs.applicantCount,
    })
    .from(jobs)
    .leftJoin(jobMatches, eq(jobs.id, jobMatches.jobId))
    .where(isNull(jobMatches.id))
    .orderBy(desc(jobs.id))
    .limit(30);

  console.log(`[Evaluation] Evaluating ${unmatchedJobs.length} jobs against resume: ${(activeResume.parsedJson as any).name}`);

  // PRE-LOAD: Build company cache to avoid N+1 queries (was querying same company 3x per job)
  const companyIds = [...new Set(unmatchedJobs.map(j => j.companyId).filter(Boolean))] as number[];
  const companyCache = new Map<number, any>();
  if (companyIds.length > 0) {
    const companyRows = await db.query.companies.findMany({
      where: inArray(companies.id, companyIds),
    });
    for (const c of companyRows) {
      companyCache.set(c.id, c);
    }
  }

  for (const job of unmatchedJobs) {
    let companyName = "Unknown Company";
    let isIndiaCompany = false;
    let companyCountry = "India";
    
    // Use cache instead of individual DB query
    if (job.companyId && companyCache.has(job.companyId)) {
      const comp = companyCache.get(job.companyId);
      companyName = comp.name;
      companyCountry = comp.country || "India";
      isIndiaCompany = companyCountry.toLowerCase() === "india";
    } else if (!job.companyId) {
      const urlObj = new URL(job.url);
      companyName = urlObj.hostname.replace("www.", "").split(".")[0];
    }

    // Pre-filter: Focus on India / local & remote opportunities for freshers
    const lowerLoc = (job.location || "").toLowerCase();
    const isNorth = lowerLoc.includes("noida") || 
                    lowerLoc.includes("gurgaon") || 
                    lowerLoc.includes("gurugram") || 
                    lowerLoc.includes("delhi") || 
                    lowerLoc.includes("ncr") || 
                    lowerLoc.includes("faridabad") || 
                    lowerLoc.includes("ghaziabad") ||
                    lowerLoc.includes("agra");

    const isSouth = lowerLoc.includes("bangalore") || 
                    lowerLoc.includes("bengaluru") || 
                    lowerLoc.includes("hyderabad") || 
                    lowerLoc.includes("pune") || 
                    lowerLoc.includes("chennai");

    const isIndiaJob = lowerLoc.includes("india") || isNorth || isSouth ||
                       lowerLoc.includes("mumbai") || 
                       lowerLoc.includes("remote");

    if (!isIndiaJob && !isIndiaCompany) {
      console.log(`[Evaluation] Skipping "${job.title}" at "${companyName}" (Outside India focus region).`);
      await db.insert(jobMatches).values({
        jobId: job.id,
        score: 0,
        whyMatched: "Skipped: outside India focus region",
        applyRecommendation: "Skip",
        priorityScore: 0,
      });
      continue;
    }

    const titleLower = job.title.toLowerCase();
    const descLower = (job.description || "").toLowerCase();
    const isWalkIn = titleLower.includes("walk-in") || titleLower.includes("walk in") || titleLower.includes("walkin") || titleLower.includes("mega walk") ||
                     descLower.includes("walk-in") || descLower.includes("walk in") || descLower.includes("walkin") || descLower.includes("mega walk");

    if (isWalkIn && isNorth) {
      console.log(`[Evaluation] MEGA WALK-IN DETECTED in North India! Sending immediate alert.`);
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const telegramMessage = 
          `<b>[WALK-IN DRIVE]</b>\n` +
          `<b>Company:</b> ${companyName}\n` +
          `<b>Role:</b> ${job.title}\n` +
          `<b>Location:</b> ${job.location || "North India"}\n` +
          `\n<a href="${job.url}">View Post</a>`;
        await sendTelegramAlert(telegramMessage);
      }
      await db.insert(jobMatches).values({
        jobId: job.id,
        score: 100,
        whyMatched: "Auto-matched: Walk-in drive in preferred location",
        applyRecommendation: "Attend Walk-in",
        priorityScore: 100,
        outreach: null,
      });
      continue;
    }

    // Rate limit throttle for Gemini Free Tier (15 RPM)
    await new Promise(resolve => setTimeout(resolve, 4000));

    console.log(`[Evaluation] Evaluating "${job.title}" at "${companyName}"...`);
    const evalResult = await evaluateJob(
      job.description || "",
      job.title,
      companyName,
      activeResume.parsedJson as any
    );

    if (evalResult.matched && evalResult.evaluation) {
      const { score, whyMatched, missingSkills, resumeGaps, interviewProbability, salaryEstimate, applyRecommendation, estimatedCompetition } = evalResult.evaluation;

      // Filter out roles with too many missing skills or low interview probability for freshers
      const missingCount = (missingSkills as string[] || []).length;
      if (missingCount > 2 || interviewProbability?.toLowerCase() === "low") {
        console.log(`[Evaluation] Skipped match at "${companyName}" due to skill gaps (${missingCount} missing) or Low probability.`);
        await db.insert(jobMatches).values({
          jobId: job.id,
          score,
          whyMatched: `Skipped: Too many missing skills (${(missingSkills as string[] || []).join(", ")}) or Low interview probability`,
          applyRecommendation: "Skip",
          priorityScore: 0,
          outreach: null,
        });
        continue;
      }
      
      // Use cached company data instead of repeated DB queries
      let companyHealth = 60;
      let hiringMomentum = 50;
      let companyPriority = 5;
      let atsType = "unknown";
      let companySize = "unknown";
      let isBigCompany = false;
      
      if (job.companyId && companyCache.has(job.companyId)) {
        const comp = companyCache.get(job.companyId);
        companyHealth = comp.healthScore || 60;
        hiringMomentum = comp.hiringMomentum || 50;
        companyPriority = comp.priority || 5;
        atsType = comp.atsType || "unknown";
        companySize = comp.companySize || "unknown";
        if (companySize === "5000+" || comp.name.toLowerCase().includes("stripe") || comp.name.toLowerCase().includes("google") || comp.name.toLowerCase().includes("microsoft") || comp.name.toLowerCase().includes("amazon") || comp.name.toLowerCase().includes("meta") || comp.name.toLowerCase().includes("apple")) {
          isBigCompany = true;
        }
      } else {
        const lowerName = companyName.toLowerCase();
        if (lowerName.includes("stripe") || lowerName.includes("google") || lowerName.includes("microsoft") || lowerName.includes("amazon") || lowerName.includes("meta") || lowerName.includes("apple") || lowerName.includes("netflix")) {
          isBigCompany = true;
        }
      }

      // Confidence score based on job source URL
      let confidenceScore = 50;
      if (job.url.includes("greenhouse.io")) confidenceScore = 90;
      else if (job.url.includes("ashbyhq.com")) confidenceScore = 90;
      else if (job.url.includes("lever.co")) confidenceScore = 85;
      else if (job.url.includes("linkedin.com")) confidenceScore = 80;
      else if (job.url.startsWith("http") && job.companyId) confidenceScore = 95;

      // Job freshness multiplier
      let freshnessMultiplier = 1.0;
      const hoursSincePost = job.postedAt ? (Date.now() - new Date(job.postedAt).getTime()) / (1000 * 60 * 60) : null;
      
      if (hoursSincePost === null) {
        freshnessMultiplier = 0.9; // Neutral/conservative when post date is unknown
      } else if (hoursSincePost <= 1) {
        freshnessMultiplier = 1.5;
      } else if (hoursSincePost <= 24) {
        freshnessMultiplier = 1.2;
      } else if (hoursSincePost <= 168) { // Posted within 7 days
        freshnessMultiplier = 1.0;
      } else {
        freshnessMultiplier = 0.4; // Heavy penalty for jobs >7 days old
      }

      // Competition multiplier (applicantCount)
      let competitionMultiplier = 1.0;
      const appCount = job.applicantCount || 0;
      if (appCount === 0) competitionMultiplier = 1.3;
      else if (appCount < 50) competitionMultiplier = 1.3;
      else if (appCount < 150) competitionMultiplier = 1.1;
      else if (appCount < 500) competitionMultiplier = 0.9;
      else competitionMultiplier = 0.7;

      // Large company penalty vs Small startup boost
      let sizeMultiplier = 1.0;
      const lowerCompName = companyName.toLowerCase();
      const isTargetBigCompany = lowerCompName.includes("accenture") || 
                                 lowerCompName.includes("wipro") || 
                                 lowerCompName.includes("infosys") || 
                                 lowerCompName.includes("tcs") || 
                                 lowerCompName.includes("deloitte") || 
                                 lowerCompName.includes("capgemini") || 
                                 lowerCompName.includes("cognizant") || 
                                 lowerCompName.includes("tech mahindra");

      if (isTargetBigCompany) {
        sizeMultiplier = 1.5; // Boost specifically targeted big companies
      } else if (isBigCompany) {
        sizeMultiplier = 0.2; // penalty for global giants for fresher matching
      } else {
        sizeMultiplier = 1.5; // boost small/mid size companies
      }

      // Regional preference boost: 70% North / 30% South split
      let regionBoost = 1.0;
      
      if (isNorth) {
        regionBoost = 1.7; // ~70% preference
      } else if (isSouth) {
        regionBoost = 0.7; // ~30% preference
      } else if (lowerLoc.includes("india") || lowerLoc.includes("remote")) {
        regionBoost = 1.2;
      }

      // Calculate priority score using formula
      const calculatedPrio = Math.round(
        score *
        (hiringMomentum / 100) *
        (companyHealth / 100) *
        (confidenceScore / 100) *
        freshnessMultiplier *
        (companyPriority / 5) *
        competitionMultiplier *
        sizeMultiplier *
        regionBoost
      );
      const priorityScore = Math.max(0, Math.min(100, calculatedPrio));

      console.log(`[Evaluation] MATCH FOUND! Score: ${score}. Priority: ${priorityScore}. Saving match details...`);

      // Save match (outreach generated lazily on 'apply')
      await db.insert(jobMatches).values({
        jobId: job.id,
        score,
        whyMatched,
        missingSkills,
        resumeGaps,
        interviewProbability,
        applyRecommendation,
        priorityScore,
        outreach: null,
      });

      // Send to n8n webhook
      if (process.env.N8N_WEBHOOK_URL) {
        console.log(`[Notification] Forwarding match to n8n at ${process.env.N8N_WEBHOOK_URL}...`);
        try {
          await fetch(process.env.N8N_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: job.id,
              companyName,
              title: job.title,
              url: job.url,
              location: job.location,
              salary: salaryEstimate || job.salary,
              score,
              priorityScore,
              whyMatched,
              missingSkills,
              resumeGaps,
              interviewProbability,
              applyRecommendation,
              estimatedCompetition,
              outreach: null,
            }),
          });
        } catch (webhookErr) {
          console.error("[Notification] n8n Webhook delivery failed:", webhookErr);
        }
      }

      const isFreshForAlert = hoursSincePost === null || hoursSincePost <= 168;
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && priorityScore >= 35 && isFreshForAlert) {
        console.log("[Notification] Forwarding match alert to Telegram...");
        
        const inrSalary = formatSalaryToINR(salaryEstimate || job.salary);
        const telegramMessage = 
          `<b>Company:</b> ${companyName}\n` +
          `<b>Role:</b> ${job.title}\n` +
          `<b>Location:</b> ${job.location || "Remote"}\n` +
          (inrSalary !== "Not Disclosed" ? `<b>Salary:</b> ${inrSalary}\n` : "") +
          `\n<a href="${job.url}">Apply Here</a>`;
        
        await sendTelegramAlert(telegramMessage);
      }
    } else {
      await db.insert(jobMatches).values({
        jobId: job.id,
        score: evalResult.evaluation?.score || 0,
        whyMatched: evalResult.reason || "Skipped by filter",
        applyRecommendation: "Skip",
      });
    }
  }
}

export function formatSalaryToINR(rawSalary: string | null | undefined): string {
  if (!rawSalary || rawSalary.toLowerCase() === "not disclosed" || rawSalary.toLowerCase() === "n/a") {
    return "Not Disclosed";
  }
  const clean = rawSalary.trim();
  if (clean.includes("INR") || clean.toLowerCase().includes("lpa") || clean.toLowerCase().includes("lakh")) {
    return clean;
  }

  const exchangeRate = 85;
  const usdMatch = clean.match(/(\$|\bUSD\b)?\s*([\d,]+(?:\.\d+)?)\s*(k|kilo|thousand|m|million)?(?:\s*-\s*(\$|\bUSD\b)?\s*([\d,]+(?:\.\d+)?)\s*(k|kilo|thousand|m|million)?)?/i);

  if (usdMatch) {
    const parseAmount = (valStr: string, multiplierStr: string) => {
      let num = parseFloat(valStr.replace(/,/g, ""));
      if (isNaN(num)) return 0;
      const mult = (multiplierStr || "").toLowerCase();
      if (mult === "k" || mult === "kilo" || mult === "thousand") num *= 1000;
      else if (mult === "m" || mult === "million") num *= 1000000;
      return num;
    };

    const num1 = parseAmount(usdMatch[2], usdMatch[3]);
    const num2 = usdMatch[5] ? parseAmount(usdMatch[5], usdMatch[6]) : null;

    const toInrFormat = (numInUsd: number) => {
      const inrTotal = numInUsd * exchangeRate;
      if (inrTotal >= 10000000) {
        return `INR ${(inrTotal / 10000000).toFixed(2)} Cr`;
      } else if (inrTotal >= 100000) {
        return `INR ${(inrTotal / 100000).toFixed(1)} Lakhs`;
      } else {
        return `INR ${Math.round(inrTotal).toLocaleString("en-IN")}`;
      }
    };

    if (num1 > 0) {
      const formatted1 = toInrFormat(num1);
      if (num2 && num2 > 0) {
        const formatted2 = toInrFormat(num2);
        return `${formatted1} - ${formatted2}/yr`;
      }
      return `${formatted1}/yr`;
    }
  }

  return clean;
}

async function sendTelegramAlert(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
    console.log("[Notification] Telegram alert sent successfully!");
  } catch (err) {
    console.error("[Notification] Telegram alert delivery failed:", err);
  }
}

function getCrawlIntervalMinutes(priority: number): number {
  if (priority >= 10) return 5;
  if (priority >= 8) return 15;
  if (priority >= 5) return 60;
  return 1440; // 24 hours for dormant
}

function calculateEffectivePriority(company: any): number {
  let prio = company.priority || 5;

  // 1. Seasonality boost (Jul-Sep is index 6, 7, 8)
  const currentMonth = new Date().getMonth();
  const isHighSeason = currentMonth >= 6 && currentMonth <= 8;
  if (isHighSeason) {
    prio += 1;
  }

  // 2. India expansion or funding boost
  if (company.indiaExpansion) {
    prio += 1;
  }
  
  return Math.min(10, prio);
}
