import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { members } from "../src/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function fixRemainingEmails() {
  console.log("Fixing remaining emails with name variations...\n");

  const fixes = [
    { firstName: "Ms Jane", lastName: "Enneking", email: "janemenneking@gmail.com" },
    { firstName: "J Dale", lastName: "Hartman", email: "jdhartman8@gmail.com" },
    { firstName: "Ms Portia", lastName: "Opoku Agyeman", email: "porshyah@gmail.com" },
    { firstName: "A J", lastName: "Westlund", email: "pdgaj0812@gmail.com" },
  ];

  for (const fix of fixes) {
    await db
      .update(members)
      .set({ email: fix.email })
      .where(
        and(
          eq(members.firstName, fix.firstName),
          eq(members.lastName, fix.lastName)
        )
      );

    console.log(`✓ ${fix.firstName} ${fix.lastName} → ${fix.email}`);
  }

  console.log("\n✅ All emails updated!");
  process.exit(0);
}

fixRemainingEmails().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
