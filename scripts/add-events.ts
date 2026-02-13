import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/db";
import { events } from "../src/lib/db/schema";

async function addEvents() {
  console.log("Adding events...");

  const eventsToAdd = [
    {
      title: "District Convention Registration Deadline",
      description: "Last day to register for our district convention. Let's bring out the Club and support OH5 District Gov Carl Gass at the District Convention on March 13th and 14th.",
      startDate: new Date("2026-02-16T23:59:00"),
      endDate: new Date("2026-02-16T23:59:00"),
      isPublic: false,
      location: null,
      maxAttendees: null,
    },
    {
      title: "Wine with the Lions",
      description: "Join us at the COhatch Garden Room from 5-7 pm. Please bring a guest or neighbor to find out more about Lionism. A few of our previous sponsors from the Rudolph 5K will be in. Thank you for everyone who brought wine in for this event! Hope to see many of you. This will be a fun non-general meeting Lions get together!",
      startDate: new Date("2026-02-17T17:00:00"),
      endDate: new Date("2026-02-17T19:00:00"),
      location: "COhatch Garden Room, 240 S. State Street, Westerville OH 43081",
      isPublic: true,
      maxAttendees: null,
    },
    {
      title: "Member Speak Spotlight - Lion Chris Kimpel",
      description: "Our Member Speak Spotlight continues with Lion Chris Kimpel. First VP Mimi stopped by my office yesterday and we put together a great booklet that Mimi has been working on for this. If you enjoyed the work Mimi did for John and Bill for their 50th Anniversary then you'll definitely enjoy reading about Chris as a nice side piece to her talk. As part of our service project for the Convention, please bring in shampoo, deodorant and body wash. Special thanks to Lion Howard for creating and organizing our donation!",
      startDate: new Date("2026-02-19T18:30:00"),
      endDate: new Date("2026-02-19T20:00:00"),
      location: null,
      isPublic: false,
      maxAttendees: null,
    },
  ];

  for (const event of eventsToAdd) {
    await db.insert(events).values(event);
    console.log(`✓ Added: ${event.title}`);
  }

  console.log("\n✅ Events added successfully!");
  process.exit(0);
}

addEvents().catch((error) => {
  console.error("Error adding events:", error);
  process.exit(1);
});
