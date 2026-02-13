import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function updateBoardPositions() {
  console.log("Updating board positions...");

  const boardMembers = [
    { firstName: "Kris", lastName: "Thompson", position: "President" },
    { firstName: "Debbie", lastName: "Bennati", position: "Membership Chair" },
    { firstName: "Mimi", lastName: "Reinhoudt", position: "1st Vice President" },
    { firstName: "Jane", lastName: "Enneking", position: "Lion Tamer" },
    { firstName: "Alex", lastName: "LeVasseur", position: "2nd Vice President" },
    { firstName: "Art", lastName: "Robertson", position: "2nd Year Director" },
    { firstName: "Lori", lastName: "Lampel", position: "Secretary" },
    { firstName: "Beth", lastName: "Robertson", position: "2nd Year Director" },
    { firstName: "Jim", lastName: "Shively", position: "Treasurer" },
    { firstName: "Chris", lastName: "Henson", position: "1st Year Director" },
    { firstName: "Howard", lastName: "Baum", position: "Tail Twister/IPP" },
    { firstName: "Bill", lastName: "Phythyon", position: "1st Year Director" },
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

  console.log("\n✅ Board positions updated successfully!");
  process.exit(0);
}

updateBoardPositions().catch((error) => {
  console.error("Error updating board positions:", error);
  process.exit(1);
});
