import { pgTable, serial, text, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").unique().notNull(),
  website: text("website"),
  atsType: text("ats_type"),
  atsUrl: text("ats_url"),
  isMonitored: boolean("is_monitored").default(true).notNull(),
  sector: text("sector"),
  priority: integer("priority").default(5).notNull(),
  country: text("country").default("India"),
  indiaExpansion: boolean("india_expansion").default(false).notNull(),
  remoteFriendly: boolean("remote_friendly").default(false).notNull(),
  companySize: text("company_size"),
  fundingStage: text("funding_stage"),
  lastFundingDate: text("last_funding_date"),
  hiringMomentum: integer("hiring_momentum").default(50).notNull(),
  healthScore: integer("health_score").default(50).notNull(),
  lastCrawledAt: text("last_crawled_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").unique().notNull(),
  description: text("description"),
  location: text("location"),
  salary: text("salary"),
  postedAt: text("posted_at").default(sql`CURRENT_TIMESTAMP`),
  hash: text("hash").unique().notNull(),
  rawJson: jsonb("raw_json"),
  applicantCount: integer("applicant_count"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => {
  return {
    hashIdx: index("jobs_hash_idx").on(table.hash),
    companyIdIdx: index("jobs_company_id_idx").on(table.companyId),
    postedAtIdx: index("jobs_posted_at_idx").on(table.postedAt),
  };
});

export const resumeProfile = pgTable("resume_profile", {
  id: serial("id").primaryKey(),
  parsedJson: jsonb("parsed_json").notNull(),
  rawText: text("raw_text").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const jobMatches = pgTable("job_matches", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).unique().notNull(),
  score: integer("score").notNull(),
  whyMatched: text("why_matched"),
  missingSkills: jsonb("missing_skills"),
  resumeGaps: text("resume_gaps"),
  interviewProbability: text("interview_probability"),
  applyRecommendation: text("apply_recommendation"),
  priorityScore: integer("priority_score"),
  outreach: jsonb("outreach"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => {
  return {
    jobIdIdx: index("job_matches_job_id_idx").on(table.jobId),
    priorityScoreIdx: index("job_matches_priority_score_idx").on(table.priorityScore),
  };
});

export const recruiters = pgTable("recruiters", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title"),
  linkedinUrl: text("linkedin_url"),
  email: text("email"),
  outreachStatus: text("outreach_status").default("none").notNull(),
  personalizedMessage: text("personalized_message"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).unique().notNull(),
  status: text("status").default("applied").notNull(),
  appliedAt: text("applied_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  notes: text("notes"),
  responseHistory: jsonb("response_history"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const eventsTimeline = pgTable("events_timeline", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(),
  description: text("description"),
  occurredAt: text("occurred_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const historicalSnapshots = pgTable("historical_snapshots", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  salary: text("salary"),
  applicantCount: integer("applicant_count"),
  jobRemoved: boolean("job_removed").default(false).notNull(),
  location: text("location"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});
