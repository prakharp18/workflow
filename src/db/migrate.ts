import { client } from "./db";

async function runMigrations() {
  console.log("[Database] Initializing database schema...");
  try {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS \`companies\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`name\` text NOT NULL,
        \`website\` text,
        \`ats_type\` text,
        \`ats_url\` text,
        \`is_monitored\` integer DEFAULT true NOT NULL,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS \`companies_name_unique\` ON \`companies\` (\`name\`);

      CREATE TABLE IF NOT EXISTS \`jobs\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`company_id\` integer,
        \`title\` text NOT NULL,
        \`url\` text NOT NULL,
        \`description\` text,
        \`location\` text,
        \`salary\` text,
        \`posted_at\` text DEFAULT CURRENT_TIMESTAMP,
        \`hash\` text NOT NULL,
        \`raw_json\` text,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (\`company_id\`) REFERENCES \`companies\`(\`id\`) ON UPDATE no action ON DELETE cascade
      );
      CREATE UNIQUE INDEX IF NOT EXISTS \`jobs_url_unique\` ON \`jobs\` (\`url\`);
      CREATE UNIQUE INDEX IF NOT EXISTS \`jobs_hash_unique\` ON \`jobs\` (\`hash\`);

      CREATE TABLE IF NOT EXISTS \`job_matches\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`job_id\` integer NOT NULL,
        \`score\` integer NOT NULL,
        \`why_matched\` text,
        \`missing_skills\` text,
        \`resume_gaps\` text,
        \`interview_probability\` text,
        \`apply_recommendation\` text,
        \`priority_score\` integer,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (\`job_id\`) REFERENCES \`jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
      );
      CREATE UNIQUE INDEX IF NOT EXISTS \`job_matches_job_id_unique\` ON \`job_matches\` (\`job_id\`);

      CREATE TABLE IF NOT EXISTS \`recruiters\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`company_id\` integer,
        \`name\` text NOT NULL,
        \`title\` text,
        \`linkedin_url\` text,
        \`email\` text,
        \`outreach_status\` text DEFAULT 'none' NOT NULL,
        \`personalized_message\` text,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (\`company_id\`) REFERENCES \`companies\`(\`id\`) ON UPDATE no action ON DELETE cascade
      );

      CREATE TABLE IF NOT EXISTS \`resume_profile\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`parsed_json\` text NOT NULL,
        \`raw_text\` text NOT NULL,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;

    await client.executeMultiple(schemaSql);
    console.log("[Database] Schema initialized successfully!");
  } catch (err) {
    console.error("[Database] Schema initialization failed:", err);
    process.exit(1);
  }
}

runMigrations();
