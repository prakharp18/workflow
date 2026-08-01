import { db } from "../db/db";
import { companies, jobs, jobMatches, resumeProfile, recruiters, eventsTimeline, historicalSnapshots } from "../db/schema";
import { eq, isNull } from "drizzle-orm";
import { crawlLinkedIn } from "../crawler/linkedin";
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

  // 2. Crawl ATS platforms dynamically based on scheduling interval
  for (const comp of monitoredCompanies) {
    const effectivePrio = calculateEffectivePriority(comp);
    const intervalMins = getCrawlIntervalMinutes(effectivePrio);
    
    let isDue = true;
    if (comp.lastCrawledAt) {
      const lastCrawled = new Date(comp.lastCrawledAt).getTime();
      const elapsedMins = (Date.now() - lastCrawled) / (1000 * 60);
      isDue = elapsedMins >= intervalMins;
    }
    
    if (!isDue) {
      console.log(`[Sync] Skipping ${comp.name} (Effective Priority: ${effectivePrio}, last crawled ${Math.round((Date.now() - new Date(comp.lastCrawledAt!).getTime()) / 60000)} mins ago, interval is ${intervalMins} mins)`);
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
    } catch (err) {
      console.error(`[Sync] Error crawling company ${comp.name}:`, err);
    }
  }

  // 3. Crawl LinkedIn for target developer & engineering roles
  try {
    const linkedInKeywords = [
      "software engineer", 
      "frontend developer", 
      "backend developer", 
      "full stack developer", 
      "react developer", 
      "node.js developer", 
      "python developer", 
      "sde-1", 
      "sde"
    ];
    const linkedInJobs = await crawlLinkedIn(linkedInKeywords, "India");
    allCrawledJobs.push(...linkedInJobs);

    // 3.5 Crawl Global ATS Boards for hidden startups
    const globalAtsJobs = await crawlGlobalATS(linkedInKeywords, "India");
    allCrawledJobs.push(...globalAtsJobs);
  } catch (err) {
    console.error("[Sync] LinkedIn/Global ATS crawl failed:", err);
  }

  // 4. Crawl RemoteOK
  try {
    const remoteOkJobs = await crawlRemoteOK();
    allCrawledJobs.push(...remoteOkJobs);
  } catch (err) {
    console.error("[Sync] RemoteOK crawl failed:", err);
  }

  // 5. Crawl YC Jobs RSS
  try {
    const ycJobs = await crawlYCJobs();
    allCrawledJobs.push(...ycJobs);
  } catch (err) {
    console.error("[Sync] YC Jobs crawl failed:", err);
  }

  console.log(`[Sync] Crawled a total of ${allCrawledJobs.length} jobs. Saving new ones to DB...`);
  
  let newJobsCount = 0;

  // 4. Save to Database (Deduplicating using URL hash)
  for (const jobData of allCrawledJobs) {
    const hash = crypto.createHash("md5").update(jobData.url).digest("hex");
    
    // Check duplicate
    const existing = await db.query.jobs.findFirst({
      where: eq(jobs.hash, hash),
    });

    if (!existing) {
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
        newJobsCount++;
      } catch (err) {
        console.error(`[Sync] Failed to save job "${jobData.title}":`, err);
      }
    }
  }

  console.log(`[Sync] Saved ${newJobsCount} new jobs.`);
  
  // 5. Automatically evaluate new/unmatched jobs against active resume
  await runMatchEvaluation();
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

  // Find jobs that don't have an entry in jobMatches
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
    .limit(20);

  console.log(`[Evaluation] Evaluating ${unmatchedJobs.length} jobs against resume: ${(activeResume.parsedJson as any).name}`);

  for (const job of unmatchedJobs) {
    let companyName = "Unknown Company";
    let isIndiaCompany = false;
    let companyCountry = "India";
    if (job.companyId) {
      const comp = await db.query.companies.findFirst({
        where: eq(companies.id, job.companyId),
      });
      if (comp) {
        companyName = comp.name;
        companyCountry = comp.country || "India";
        isIndiaCompany = companyCountry.toLowerCase() === "india";
      }
    } else {
      const urlObj = new URL(job.url);
      companyName = urlObj.hostname.replace("www.", "").split(".")[0];
    }

    // Pre-filter: Focus on India / local & remote opportunities for freshers
    const lowerLoc = (job.location || "").toLowerCase();
    const isIndiaJob = lowerLoc.includes("india") || 
                       lowerLoc.includes("bangalore") || 
                       lowerLoc.includes("bengaluru") ||
                       lowerLoc.includes("hyderabad") || 
                       lowerLoc.includes("pune") || 
                       lowerLoc.includes("delhi") || 
                       lowerLoc.includes("gurgaon") || 
                       lowerLoc.includes("gurugram") ||
                       lowerLoc.includes("noida") || 
                       lowerLoc.includes("mumbai") || 
                       lowerLoc.includes("chennai") ||
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

    // Rate limit throttle for Gemini Free Tier (15 RPM)
    await new Promise(resolve => setTimeout(resolve, 4500));

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
      
      let companyHealth = 60;
      let hiringMomentum = 50;
      let companyPriority = 5;
      let atsType = "unknown";
      
      if (job.companyId) {
        const comp = await db.query.companies.findFirst({
          where: eq(companies.id, job.companyId),
        });
        if (comp) {
          companyHealth = comp.healthScore || 60;
          hiringMomentum = comp.hiringMomentum || 50;
          companyPriority = comp.priority || 5;
          atsType = comp.atsType || "unknown";
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

      // Check if giant company
      let isBigCompany = false;
      let companySize = "unknown";
      if (job.companyId) {
        const comp = await db.query.companies.findFirst({
          where: eq(companies.id, job.companyId),
        });
        if (comp) {
          companyHealth = comp.healthScore || 60;
          hiringMomentum = comp.hiringMomentum || 50;
          companyPriority = comp.priority || 5;
          atsType = comp.atsType || "unknown";
          companySize = comp.companySize || "unknown";
          if (companySize === "5000+" || comp.name.toLowerCase().includes("stripe") || comp.name.toLowerCase().includes("google") || comp.name.toLowerCase().includes("microsoft") || comp.name.toLowerCase().includes("amazon") || comp.name.toLowerCase().includes("meta") || comp.name.toLowerCase().includes("apple")) {
            isBigCompany = true;
          }
        }
      } else {
        const lowerName = companyName.toLowerCase();
        if (lowerName.includes("stripe") || lowerName.includes("google") || lowerName.includes("microsoft") || lowerName.includes("amazon") || lowerName.includes("meta") || lowerName.includes("apple") || lowerName.includes("netflix")) {
          isBigCompany = true;
        }
      }

      // Large company penalty vs Small startup boost
      let sizeMultiplier = 1.0;
      if (isBigCompany) {
        sizeMultiplier = 0.2; // penalty for global giants for fresher matching
      } else {
        sizeMultiplier = 1.5; // boost small/mid size companies
      }

      // India expansion/local hub boost
      let indiaBoost = 1.0;
      const lowerLoc = (job.location || "").toLowerCase();
      if (lowerLoc.includes("india") || lowerLoc.includes("bangalore") || lowerLoc.includes("hyderabad") || lowerLoc.includes("pune") || lowerLoc.includes("delhi") || lowerLoc.includes("gurgaon") || lowerLoc.includes("noida") || lowerLoc.includes("chennai")) {
        indiaBoost = 1.5;
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
        indiaBoost
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

      // Send to Telegram (only if match priority score >= 35 AND job is fresh - posted within 7 days)
      const isFreshForAlert = hoursSincePost === null || hoursSincePost <= 168;
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && priorityScore >= 35 && isFreshForAlert) {
        console.log("[Notification] Forwarding fresh match to Telegram...");
        const telegramMessage = `🎯 <b>New High-Match Job Found!</b>\n\n` +
          `<b>Company:</b> ${companyName}\n` +
          `<b>Role:</b> ${job.title}\n` +
          `<b>Location:</b> ${job.location || "Remote"}\n` +
          `<b>Salary:</b> ${salaryEstimate || "N/A"}\n` +
          `<b>ATS Detected:</b> ${atsType.toUpperCase()}\n` +
          `<b>Hiring Momentum:</b> ${hiringMomentum}/100\n` +
          `<b>Company Health:</b> ${companyHealth}/100\n` +
          `<b>Match Score:</b> ${score}/100\n` +
          `<b>Priority Score:</b> ${priorityScore}/100\n\n` +
          `<b>Why Recommended:</b>\n${whyMatched}\n\n` +
          `<b>Missing Skills:</b> ${(missingSkills as string[] || []).join(", ") || "None"}\n\n` +
          `👉 <a href="${job.url}">Apply Here</a>`;
        
        await sendTelegramAlert(telegramMessage);
      }
    } else {
      // Even if it didn't match, insert a score of 0 or filter status to prevent re-evaluation
      await db.insert(jobMatches).values({
        jobId: job.id,
        score: evalResult.evaluation?.score || 0,
        whyMatched: evalResult.reason || "Skipped by filter",
        applyRecommendation: "Skip",
      });
    }
  }
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
