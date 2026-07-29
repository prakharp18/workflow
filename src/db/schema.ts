import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  website: text("website"),
  atsType: text("ats_type"), // greenhouse, lever, ashby, custom
  atsUrl: text("ats_url"),
  isMonitored: integer("is_monitored", { mode: "boolean" }).default(true).notNull(),
  sector: text("sector"),
  priority: integer("priority").default(5).notNull(),
  country: text("country").default("India"),
  indiaExpansion: integer("india_expansion", { mode: "boolean" }).default(false).notNull(),
  remoteFriendly: integer("remote_friendly", { mode: "boolean" }).default(false).notNull(),
  companySize: text("company_size"),
  fundingStage: text("funding_stage"),
  lastFundingDate: text("last_funding_date"),
  hiringMomentum: integer("hiring_momentum").default(50).notNull(),
  healthScore: integer("health_score").default(50).notNull(),
  lastCrawledAt: text("last_crawled_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").unique().notNull(),
  description: text("description"),
  location: text("location"),
  salary: text("salary"),
  postedAt: text("posted_at").default(sql`CURRENT_TIMESTAMP`),
  hash: text("hash").unique().notNull(),
  rawJson: text("raw_json", { mode: "json" }),
  applicantCount: integer("applicant_count"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const resumeProfile = sqliteTable("resume_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parsedJson: text("parsed_json", { mode: "json" }).notNull(), // skills, experience, etc.
  rawText: text("raw_text").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const jobMatches = sqliteTable("job_matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).unique().notNull(),
  score: integer("score").notNull(),
  whyMatched: text("why_matched"),
  missingSkills: text("missing_skills", { mode: "json" }), // array of strings
  resumeGaps: text("resume_gaps"),
  interviewProbability: text("interview_probability"),
  applyRecommendation: text("apply_recommendation"),
  priorityScore: integer("priority_score"),
  outreach: text("outreach", { mode: "json" }), // linkedinRequest, coldEmail, referralMessage
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const recruiters = sqliteTable("recruiters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  email: text("email"),
  outreachStatus: text("outreach_status").default("none").notNull(), // none, pending, sent
  personalizedMessage: text("personalized_message"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).unique().notNull(),
  status: text("status").default("applied").notNull(), // applied, interviewing, offered, rejected, ghosted
  appliedAt: text("applied_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  notes: text("notes"),
  responseHistory: text("response_history", { mode: "json" }), // array of updates: { date: string, note: string }
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const eventsTimeline = sqliteTable("events_timeline", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(), // funding, office_opening, EM_hired, ats_added, first_job
  description: text("description"),
  occurredAt: text("occurred_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const historicalSnapshots = sqliteTable("historical_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  salary: text("salary"),
  applicantCount: integer("applicant_count"),
  jobRemoved: integer("job_removed", { mode: "boolean" }).default(false).notNull(),
  location: text("location"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});
