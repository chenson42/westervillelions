import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function fixBoardPositions() {
  console.log("Fixing board positions with correct names...\n");

  const boardMembers = [
    // Names that match the database exactly
    { firstName: "Miriam", lastName: "Reinhoudt", position: "1st Vice President" },
    { firstName: "Ms Jane", lastName: "Enneking", position: "Lion Tamer" },
    { firstName: "Alex", lastName: "Levasseur", position: "2nd Vice President" },
    { firstName: "Arthur", lastName: "Robertson", position: "2nd Year Director" },
    { firstName: "James", lastName: "Shively", position: "Treasurer" },
    { firstName: "William", lastName: "Phythyon", position: "1st Year Director" },
  ];

  for (const boardMember of boardMembers) {
    const result = await db
      .update(members)
      .set({ boardPosition: boardMember.position })
      .where(
        and(
          eq(members.firstName, boardMember.firstName),
          eq(members.lastName, boardMember.lastName)
        )
      );

    console.log(`✓ ${boardMember.firstName} ${boardMember.lastName} → ${boardMember.position}`);
  }

  console.log("\n✅ Missing board positions updated successfully!");
  process.exit(0);
}

fixBoardPositions().catch((error) => {
  console.error("Error updating board positions:", error);
  process.exit(1);
});
