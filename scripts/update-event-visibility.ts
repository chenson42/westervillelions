import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { events } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function updateEventVisibility() {
  console.log("Updating event visibility...");

  // Make Wine with the Lions private
  await db
    .update(events)
    .set({ isPublic: false })
    .where(eq(events.title, "Wine with the Lions"));
  console.log("✓ Wine with the Lions → Private");

  // Make Member Speak Spotlight public
  await db
    .update(events)
    .set({ isPublic: true })
    .where(eq(events.title, "Member Speak Spotlight - Lion Chris Kimpel"));
  console.log("✓ Member Speak Spotlight - Lion Chris Kimpel → Public");

  console.log("\n✅ Event visibility updated successfully!");
  process.exit(0);
}

updateEventVisibility().catch((error) => {
  console.error("Error updating event visibility:", error);
  process.exit(1);
});
