/** B-180: the one definition of "this stuffy has a check-in photo on file" (current, not retaken, not purged). */

import { sql } from "drizzle-orm";
import { swStuffies } from "@/lib/db/schema";

export const hasCheckInPhotoSql = sql<boolean>`exists (select 1 from sw_photos cp where cp.stuffy_id = ${swStuffies.id} and cp.kind = 'check_in' and cp.superseded_at is null and cp.purged_at is null)`;
