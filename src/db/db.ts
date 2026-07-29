import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import dotenv from "dotenv";

dotenv.config();

const dbUrl = process.env.DATABASE_URL || "file:local.db";

console.log(`[Database] Connecting to SQLite database at: ${dbUrl}`);

const client = createClient({
  url: dbUrl,
});

export const db = drizzle(client, { schema });
export { client };
export * as schema from "./schema";
