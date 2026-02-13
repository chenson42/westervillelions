import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { events } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function addEventPhoto() {
  console.log("Adding photo to Wine with the Lions event...\n");

  await db
    .update(events)
    .set({ image: "/images/event-wine-with-lions.jpg" })
    .where(eq(events.title, "Wine with the Lions"));

  console.log("✓ Wine with the Lions event photo added");
  console.log("\n✅ Event photo updated successfully!");
  process.exit(0);
}

addEventPhoto().catch((error) => {
  console.error("Error adding event photo:", error);
  process.exit(1);
});
