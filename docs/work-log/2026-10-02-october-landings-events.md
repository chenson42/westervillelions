# 2026-10-02 — October events from the Landings email (production data entry)

**Type:** Data entry, not a code change. No pipeline phases apply; logged because it is a production write.

**User's words:** "can you look for this email and update our event callendar accordingly? Fw: Updated Halloween Night Date + Walk to End Alzheimer's"

**Source:** Email forwarded to the club list on 2026-10-02 by the Activities chair, relaying an update from the Landings of Westerville administrator:
- Halloween Night (trick-or-treat; club runs the popcorn machine) moved to **Wednesday 2026-10-28, 6:00 PM**. Sign-ups to be taken at the 2026-10-15 Activities Meeting.
- Walk to End Alzheimer's is 2026-10-11, meet ~1:30 PM. The chair stated the club will **not** collaborate with the Landings on this one this year; participation is an individual decision.
- Repair Cafe at The Point at Otterbein, 2026-10-10: tent/collection boxes/brochures, setup ~9:00 AM, teardown 11:30 AM; helpers wanted.

**State before (read, production):** no event rows matched halloween / landings / alzheimer / trick; the only Repair Cafe row was 2026-04-18. `events` count: 49.

**Write (production, via psql, one transaction):** two `INSERT … SELECT … WHERE NOT EXISTS` rows into `events`, `created_by` = the operator's user id, wall-clock timestamps per DECISION-005:

| Title | Start | End | Location | Public | RSVP |
|---|---|---|---|---|---|
| Halloween Night at the Landings | 2026-10-28 18:00 | 2026-10-28 20:00 | The Landings of Westerville | no | yes |
| Visit us at the Repair Cafe | 2026-10-10 09:00 | 2026-10-10 11:30 | The Point at Otterbein | yes | yes |

**State after:** `events` count: 51. Both rows verified by SELECT.

**Judgment calls:**
- The Walk to End Alzheimer's was **not** added — the email says the club is not participating as a club.
- Halloween end time (8:00 PM) is assumed; the email gives only the 6:00 PM start. Adjust at `/admin/events/8f998e7c-9f3d-43bf-97ea-c88b0975bd06` if the flyer says otherwise.
- Repair Cafe is public (like the April row) with RSVP on so members can sign up to help with setup/teardown. The description does not name or give contact details for the member coordinating it.
- No flyer images were attached to the events (the email's attachments were not pulled).
