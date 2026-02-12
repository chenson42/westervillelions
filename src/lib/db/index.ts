import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Support both DATABASE_URL and DB_URL environment variables
const connectionString = process.env.DATABASE_URL || process.env.DB_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DB_URL environment variable is not set");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
