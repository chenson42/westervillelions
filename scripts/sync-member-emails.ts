import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members, users } from "../src/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";

async function syncMemberEmails() {
  console.log("Syncing emails from users table to members table...\n");

  // Get all members with userId
  const allMembers = await db.query.members.findMany({
    where: isNotNull(members.userId),
  });

  let updated = 0;

  for (const member of allMembers) {
    if (member.userId) {
      // Get the user's email
      const user = await db.query.users.findFirst({
        where: eq(users.id, member.userId),
      });

      if (user && user.email) {
        await db
          .update(members)
          .set({ email: user.email })
          .where(eq(members.id, member.id));

        console.log(`✓ ${member.firstName} ${member.lastName} → ${user.email}`);
        updated++;
      }
    }
  }

  console.log(`\n✅ Synced ${updated} member emails successfully!`);
  process.exit(0);
}

syncMemberEmails().catch((error) => {
  console.error("Error syncing emails:", error);
  process.exit(1);
});
