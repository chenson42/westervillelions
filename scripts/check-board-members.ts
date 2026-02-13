import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { or, and, eq } from "drizzle-orm";

async function checkBoardMembers() {
  console.log("Checking for board members in database...\n");

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
    const found = await db.query.members.findFirst({
      where: and(
        eq(members.firstName, boardMember.firstName),
        eq(members.lastName, boardMember.lastName)
      ),
    });

    if (found) {
      console.log(`✓ ${boardMember.firstName} ${boardMember.lastName} - Found (Board: ${found.boardPosition || "NOT SET"})`);
    } else {
      console.log(`✗ ${boardMember.firstName} ${boardMember.lastName} - NOT FOUND IN DATABASE`);
    }
  }

  // Also check for similar names
  console.log("\n--- Checking for similar names in database ---\n");

  const allMembers = await db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (members, { asc }) => [asc(members.lastName), asc(members.firstName)],
  });

  const lastNames = ["Thompson", "Bennati", "Reinhoudt", "Enneking", "LeVasseur", "Robertson", "Lampel", "Shively", "Henson", "Baum", "Phythyon"];

  for (const lastName of lastNames) {
    const matches = allMembers.filter(m => m.lastName.toLowerCase().includes(lastName.toLowerCase()) || lastName.toLowerCase().includes(m.lastName.toLowerCase()));
    if (matches.length > 0) {
      matches.forEach(m => {
        console.log(`${m.firstName} ${m.lastName} - Board: ${m.boardPosition || "(none)"}`);
      });
    }
  }

  process.exit(0);
}

checkBoardMembers().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
