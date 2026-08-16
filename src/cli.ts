#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import { db } from "./db/db";
import { resumeProfile, companies, jobs, jobMatches, recruiters, applications } from "./db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { parseResume, generateOutreach } from "./core/geminiService";
import { runJobSync, runMatchEvaluation } from "./core/sync";
import { registerDiscoveredCompany } from "./core/intelligenceAgent";
import { startBackgroundWorker } from "./workers/cron";
import { runSeed } from "./db/seed";
import { runCompanyDiscovery } from "./core/discoveryAgent";
import { runDbCleanup } from "./db/cleanup";
import dotenv from "dotenv";

dotenv.config();

const program = new Command();

program
  .name("jobs")
  .description("Autonomous AI-powered Job Intelligence Platform tails to resume")
  .version("1.0.0");

// Command: watch
program
  .command("watch")
  .description("Start the background crawler and matching worker")
  .action(() => {
    console.log("[CLI] Launching Job Intelligence daemon...");
    startBackgroundWorker();
    
    // Keep process alive
    setInterval(() => {}, 1000 * 60 * 60);
  });

// Command: seed
program
  .command("seed")
  .description("Seed the database with curated product and AI startups")
  .action(async () => {
    console.log("[CLI] Seeding database...");
    try {
      await runSeed();
    } catch (err) {
      console.error("[CLI] Seed error:", err);
    }
    process.exit(0);
  });

// Command: discover
program
  .command("discover")
  .description("Scan YC and HN to discover new startup companies automatically")
  .action(async () => {
    console.log("[CLI] Running Company Discovery Agent...");
    try {
      await runCompanyDiscovery();
    } catch (err) {
      console.error("[CLI] Discovery error:", err);
    }
    process.exit(0);
  });

// Command: sync
program
  .command("sync")
  .description("Manually crawl and sync jobs from ATS and LinkedIn")
  .action(async () => {
    console.log("[CLI] Running manual synchronization...");
    try {
      await runJobSync();
      console.log("[CLI] Synchronization finished successfully.");
    } catch (err) {
      console.error("[CLI] Sync execution error:", err);
    }
    process.exit(0);
  });

// Command: scan
program
  .command("scan")
  .argument("[path]", "Path to resume text file", "resume.txt")
  .description("Parse resume and evaluate matches on all jobs")
  .action(async (path) => {
    console.log(`[CLI] Scanning resume file: ${path}...`);
    if (!fs.existsSync(path)) {
      console.error(`[CLI] Error: Resume file not found at ${path}`);
      process.exit(1);
    }

    try {
      const resumeText = fs.readFileSync(path, "utf-8");
      console.log("[CLI] Extracted resume text. Parsing with Gemini AI...");
      
      const parsed = await parseResume(resumeText);
      console.log(`[CLI] Successfully parsed profile for candidate: ${parsed.name}`);
      
      // Save to database
      await db.insert(resumeProfile).values({
        parsedJson: parsed,
        rawText: resumeText,
      });

      console.log("[CLI] Saved parsed resume to Database as source of truth.");
      
      // Run evaluation
      await runMatchEvaluation();
    } catch (err) {
      console.error("[CLI] Scan error:", err);
    }
    process.exit(0);
  });

// Command: apply
program
  .command("apply")
  .argument("<jobId>", "Job ID to apply for")
  .description("Retrieve candidate outreach materials and mark job as applied")
  .action(async (jobIdStr) => {
    const jobId = parseInt(jobIdStr, 10);
    if (isNaN(jobId)) {
      console.error("[CLI] Error: Job ID must be a number");
      process.exit(1);
    }

    try {
      const match = await db.query.jobMatches.findFirst({
        where: eq(jobMatches.jobId, jobId),
      });

      const job = await db.query.jobs.findFirst({
        where: eq(jobs.id, jobId),
      });

      if (!job) {
        console.error(`[CLI] Error: Job with ID ${jobId} not found`);
        process.exit(1);
      }

      let companyName = "Unknown";
      if (job.companyId) {
        const comp = await db.query.companies.findFirst({
          where: eq(companies.id, job.companyId),
        });
        if (comp) companyName = comp.name;
      }

      console.log(`\n======================================================`);
      console.log(`Job: ${job.title} at ${companyName}`);
      console.log(`URL: ${job.url}`);
      console.log(`Match Score: ${match?.score ?? "N/A"}`);
      console.log(`======================================================\n`);

      // Print outreach drafts from jobMatches.outreach (Generate lazily if not present)
      let outreachData = match?.outreach;
      if (match && !outreachData) {
        console.log("[CLI] Generating custom outreach templates using Gemini AI...");
        const activeResume = await db.query.resumeProfile.findFirst({
          orderBy: (rp, { desc }) => [desc(rp.createdAt)],
        });
        if (activeResume) {
          try {
            outreachData = await generateOutreach(job.title, companyName, activeResume.parsedJson as any);
            // Save it back to database
            await db.update(jobMatches)
              .set({ outreach: outreachData })
              .where(eq(jobMatches.jobId, jobId));
          } catch (outreachErr) {
            console.error("[CLI] Error generating outreach dynamically:", outreachErr);
          }
        }
      }

      if (outreachData) {
        const outreach = outreachData as any;
        console.log(`--- LINKEDIN CONNECTION INVITE ---`);
        console.log(outreach.linkedinRequest || "N/A");
        console.log(`----------------------------------\n`);

        console.log(`--- COLD EMAIL OUTREACH ---`);
        console.log(outreach.coldEmail || "N/A");
        console.log(`---------------------------\n`);

        console.log(`--- REFERRAL REQUEST MESSAGE ---`);
        console.log(outreach.referralMessage || "N/A");
        console.log(`--------------------------------\n`);
      } else {
        console.log("[CLI] No custom outreach drafts found for this job.");
      }

      // Save/update status in applications table
      const existingApp = await db.query.applications.findFirst({
        where: eq(applications.jobId, jobId),
      });

      if (!existingApp) {
        await db.insert(applications).values({
          jobId,
          status: "applied",
        });
      } else {
        await db.update(applications)
          .set({ status: "applied" })
          .where(eq(applications.jobId, jobId));
      }

      console.log(`[CLI] Job ${jobId} outreach retrieved. (Marked as APPLIED in your database tracking)`);
    } catch (err) {
      console.error("[CLI] Apply command error:", err);
    }
    process.exit(0);
  });

// Command: stats
program
  .command("stats")
  .description("Display stats summary of current job funnel")
  .action(async () => {
    try {
      const totalJobsResult = await db.select({ count: sql<number>`count(*)` }).from(jobs);
      const totalMatchesResult = await db.select({ count: sql<number>`count(*)` }).from(jobMatches).where(sql`score >= 50`);
      const avgScoreResult = await db.select({ avg: sql<number>`avg(score)` }).from(jobMatches).where(sql`score > 0`);
      const appliedResult = await db.select({ count: sql<number>`count(*)` }).from(applications).where(eq(applications.status, "applied"));

      console.log("\n====== Job Funnel Statistics ======");
      console.log(`Total Jobs Crawled:       ${totalJobsResult[0]?.count || 0}`);
      console.log(`High-Quality AI Matches:  ${totalMatchesResult[0]?.count || 0}`);
      console.log(`Jobs Applied (Outreached): ${appliedResult[0]?.count || 0}`);
      console.log(`Average AI Match Score:   ${Math.round(avgScoreResult[0]?.avg || 0)}/100`);
      console.log("===================================\n");
    } catch (err) {
      console.error("[CLI] Stats retrieval failed:", err);
    }
    process.exit(0);
  });

// Command: companies
const companiesCmd = program.command("companies").description("Manage company careers lists");

companiesCmd
  .command("list")
  .description("List monitored companies")
  .action(async () => {
    try {
      const list = await db.query.companies.findMany();
      console.log("\n================ Monitored Companies ================");
      list.forEach(c => {
        console.log(`ID: ${c.id} | ${c.name.padEnd(20)} | ATS: ${(c.atsType || "unknown").padEnd(12)} | Monitored: ${c.isMonitored}`);
      });
      console.log("====================================================\n");
    } catch (err) {
      console.error("[CLI] Failed to list companies:", err);
    }
    process.exit(0);
  });

companiesCmd
  .command("add")
  .argument("<name>", "Company Name")
  .argument("<careersUrl>", "Careers page URL or token identifier")
  .description("Add a company to watchlist")
  .action(async (name, careersUrl) => {
    try {
      await registerDiscoveredCompany(name, careersUrl);
    } catch (err) {
      console.error("[CLI] Failed to register company:", err);
    }
    process.exit(0);
  });

program
  .command("cleanup-db")
  .description("Prune raw JSON bloat and old skipped jobs to free up Neon DB storage")
  .action(async () => {
    console.log("[CLI] Running DB Storage Cleanup...");
    try {
      await runDbCleanup();
    } catch (err) {
      console.error("[CLI] Cleanup error:", err);
    }
    process.exit(0);
  });

// Command: analytics
program
  .command("analytics")
  .description("Display talent intelligence analytics")
  .action(async () => {
    try {
      const skillCounts: Record<string, number> = {};
      const matches = await db.query.jobMatches.findMany({
        where: sql`score >= 50`,
      });

      matches.forEach(m => {
        const skills = (m.missingSkills as string[]) || [];
        skills.forEach(s => {
          skillCounts[s] = (skillCounts[s] || 0) + 1;
        });
      });

      const topMissingSkills = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      console.log("\n============= AI Match Analytics =============");
      console.log("Top Missing Skills in Job Postings (Resume Gaps):");
      if (topMissingSkills.length === 0) {
        console.log("  No data available yet.");
      } else {
        topMissingSkills.forEach(([skill, count]) => {
          console.log(`  - ${skill.padEnd(20)} requested in ${count} jobs`);
        });
      }
      console.log("=============================================\n");
    } catch (err) {
      console.error("[CLI] Analytics failure:", err);
    }
    process.exit(0);
  });

program.parse(process.argv);
