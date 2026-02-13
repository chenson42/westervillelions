import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { isNotNull } from "drizzle-orm";

async function listBoardMembers() {
  console.log("All board members in database:\n");

  const boardMembers = await db.query.members.findMany({
    where: isNotNull(members.boardPosition),
    orderBy: (members, { asc }) => [asc(members.lastName), asc(members.firstName)],
  });

  console.log(`Total: ${boardMembers.length} board members\n`);

  boardMembers.forEach((member, index) => {
    console.log(`${index + 1}. ${member.firstName} ${member.lastName} - ${member.boardPosition}`);
  });

  process.exit(0);
}

listBoardMembers().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
