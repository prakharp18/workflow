import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.warn("[Database] WARNING: DATABASE_URL is not configured!");
} else {
  console.log("[Database] Connecting to Neon Postgres database...");
}

const sqlClient = neon(dbUrl || "postgresql://user:pass@ep-dummy.neon.tech/neondb");
export const db = drizzle(sqlClient, { schema });
export * as schema from "./schema";
