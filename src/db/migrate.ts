import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

async function runMigrations() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[Database] No DATABASE_URL set, skipping remote Postgres migration.");
    return;
  }

  console.log("[Database] Initializing Neon Postgres database schema...");
  const sql = neon(dbUrl);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        website TEXT,
        ats_type TEXT,
        ats_url TEXT,
        is_monitored BOOLEAN DEFAULT true NOT NULL,
        sector TEXT,
        priority INTEGER DEFAULT 5 NOT NULL,
        country TEXT DEFAULT 'India',
        india_expansion BOOLEAN DEFAULT false NOT NULL,
        remote_friendly BOOLEAN DEFAULT false NOT NULL,
        company_size TEXT,
        funding_stage TEXT,
        last_funding_date TEXT,
        hiring_momentum INTEGER DEFAULT 50 NOT NULL,
        health_score INTEGER DEFAULT 50 NOT NULL,
        last_crawled_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        url TEXT UNIQUE NOT NULL,
        description TEXT,
        location TEXT,
        salary TEXT,
        posted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        hash TEXT UNIQUE NOT NULL,
        raw_json JSONB,
        applicant_count INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS resume_profile (
        id SERIAL PRIMARY KEY,
        parsed_json JSONB NOT NULL,
        raw_text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS job_matches (
        id SERIAL PRIMARY KEY,
        job_id INTEGER UNIQUE NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        why_matched TEXT,
        missing_skills JSONB,
        resume_gaps TEXT,
        interview_probability TEXT,
        apply_recommendation TEXT,
        priority_score INTEGER,
        outreach JSONB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS recruiters (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        title TEXT,
        linkedin_url TEXT,
        email TEXT,
        outreach_status TEXT DEFAULT 'none' NOT NULL,
        personalized_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        job_id INTEGER UNIQUE NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'applied' NOT NULL,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        notes TEXT,
        response_history JSONB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS events_timeline (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        description TEXT,
        occurred_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS historical_snapshots (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        salary TEXT,
        applicant_count INTEGER,
        job_removed BOOLEAN DEFAULT false NOT NULL,
        location TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    console.log("[Database] Neon Postgres schema initialized successfully!");
  } catch (err) {
    console.error("[Database] Schema migration failed:", err);
    process.exit(1);
  }
}

runMigrations();
