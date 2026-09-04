import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members, groups, groupMemberships } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { MemberDirectory } from "@/components/members/member-directory";
import { MemberDirectoryPrint } from "@/components/members/member-directory-print";
import { SuggestionBoxLauncher } from "@/components/suggestion-box-launcher";
import { nowEastern } from "@/lib/events";

export default async function MembersPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  // Printable Member Directory (2026-08-07): this page had no permission
  // gate at all — any signed-in session, including a zero-role account
  // `/access-pending` exists to catch, could read every member's contact
  // details. Enforced here, before any DB query, per the Phase 1 analyst
  // review's verified-safe finding (all 52 users with any role already hold
  // members.view).
  if (!(await hasFeature(session.user.id, FEATURES.MEMBERS_VIEW))) {
    redirect("/access-pending");
  }

  const allMembers = await db.query.members.findMany({
    where: inArray(members.membershipStatus, ["active", "prospective"]),
    orderBy: (members, { asc }) => [asc(members.lastName), asc(members.firstName)],
  });

  // Fetch groups that are shown in directory
  const directoryGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      color: groups.color,
      showPositionAsTag: groups.showPositionAsTag,
    })
    .from(groups)
    .where(and(eq(groups.isActive, true), eq(groups.showInDirectory, true)));

  // Fetch memberships for those groups
  const memberIds = allMembers.map((m) => m.id);
  const directoryGroupIds = directoryGroups.map((g) => g.id);

  const memberGroupData =
    memberIds.length > 0 && directoryGroupIds.length > 0
      ? await db
          .select({
            memberId: groupMemberships.memberId,
            groupId: groupMemberships.groupId,
            position: groupMemberships.position,
          })
          .from(groupMemberships)
          .where(
            and(
              inArray(groupMemberships.memberId, memberIds),
              inArray(groupMemberships.groupId, directoryGroupIds)
            )
          )
      : [];

  // Build a map of memberId -> group tag info
  const groupMap = new Map(directoryGroups.map((g) => [g.id, g]));
  const memberTagsMap = new Map<string, { groupId: string; groupName: string; color: string | null; tag: string }[]>();
  for (const row of memberGroupData) {
    const group = groupMap.get(row.groupId);
    if (!group) continue;
    const tag = group.showPositionAsTag && row.position ? row.position : group.name;
    if (!memberTagsMap.has(row.memberId)) memberTagsMap.set(row.memberId, []);
    memberTagsMap.get(row.memberId)!.push({
      groupId: row.groupId,
      groupName: group.name,
      color: group.color,
      tag,
    });
  }

  const membersWithTags = allMembers.map((member) => ({
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    phone: member.phone,
    address: member.address,
    city: member.city,
    state: member.state,
    zip: member.zip,
    branch: member.branch,
    memberNumber: member.memberNumber,
    joinDate: member.joinDate,
    profilePicture: member.profilePicture,
    membershipStatus: member.membershipStatus as "active" | "prospective" | "ended",
    boardPosition: member.boardPosition,
    groupTags: memberTagsMap.get(member.id) ?? [],
  }));

  // Printable Member Directory (2026-08-07): active members only, in the
  // same last-name/first-name order the DB query already returned — a
  // printed sheet is kept for months, so a prospective member (who may
  // never join) doesn't belong on it. See Treasurer Decision #2.
  const printMembers = membersWithTags.filter((m) => m.membershipStatus === "active");
  const generatedOn = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Groups available as filters (those that have at least one member)
  const filterGroups = directoryGroups.map((g) => ({ id: g.id, name: g.name, color: g.color }));

  // Birthdays this month — dateOfBirth stored as "YYYY-MM-DD" or "--MM-DD" (no year).
  // nowEastern(), not new Date(): "this month" is an Eastern-wall-clock notion
  // (the club is in Ohio) and the process may run in UTC. See
  // src/lib/events.ts nowEastern() doc comment. Only matters right around a
  // month boundary near midnight Eastern, but the fix is free.
  const now = nowEastern();
  const currentMonth = now.getMonth() + 1;
  const monthName = now.toLocaleString("en-US", { month: "long" });

  function parseDobMonth(dob: string): number {
    // "--MM-DD" → month is index 2/3 after split; "YYYY-MM-DD" → index 1
    const noYear = dob.startsWith("--");
    const parts = noYear ? dob.slice(2).split("-") : dob.split("-");
    return parseInt(noYear ? parts[0] : parts[1]);
  }

  function parseDobDay(dob: string): number {
    const noYear = dob.startsWith("--");
    const parts = noYear ? dob.slice(2).split("-") : dob.split("-");
    return parseInt(noYear ? parts[1] : parts[2]);
  }

  const birthdaysThisMonth = allMembers
    .filter((m) => {
      if (!m.dateOfBirth) return false;
      return parseDobMonth(m.dateOfBirth) === currentMonth;
    })
    .sort((a, b) => parseDobDay(a.dateOfBirth!) - parseDobDay(b.dateOfBirth!));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12 print:hidden">
        <div className="container mx-auto px-4 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">Member Portal</h1>
            <p className="text-xl">Welcome, {session.user.name}!</p>
          </div>
          <SuggestionBoxLauncher className="inline-flex items-center gap-2 self-start md:self-auto bg-lions-gold text-lions-blue-dark px-5 py-3 rounded-lg font-semibold hover:brightness-95 transition shadow-md focus:outline-none focus:ring-2 focus:ring-white">
            <span aria-hidden="true">💡</span>
            <span>Suggestion Box</span>
          </SuggestionBoxLauncher>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 print:hidden">
        {/* 6-tile portal restructure (docs/work-log/2026-08-08-meeting-minutes.md,
            Phase 3 "The IA restructure", DECISION-074 Ruling 4): navigation
            regroups, routes do NOT move. Profile and Club Finances are new
            fan-out hubs to pages that already resolve at their existing URLs
            (/members/dues, /members/reimbursements, /members/impact,
            /members/financial-reports) — bookmarks and emailed links are
            unaffected. Same tile styling as before, just six instead of
            eight. */}
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 mb-12">
          <a
            href="/members"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Member Directory</h3>
            <p className="text-gray-700">View contact information for all club members</p>
          </a>
          <a
            href="/members/events"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Events</h3>
            <p className="text-gray-700">View and RSVP to upcoming club events</p>
          </a>
          <a
            href="/members/groups"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Groups</h3>
            <p className="text-gray-700">Browse committees, service teams, and branches</p>
          </a>
          <a
            href="/members/records"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Club Records</h3>
            <p className="text-gray-700">Read meeting minutes — general and board</p>
          </a>
          <a
            href="/members/profile"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Profile</h3>
            <p className="text-gray-700">Your contact info, dues, reimbursements, proposals, and social media requests</p>
          </a>
          <a
            href="/members/finances"
            className="bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Club Finances</h3>
            <p className="text-gray-700">Monthly financial statements and our community impact</p>
          </a>
        </div>

        {birthdaysThisMonth.length > 0 && (
          <div className="mb-10 rounded-2xl border border-lions-gold/40 bg-lions-gold/5 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Birthdays in {monthName}
            </h2>
            <div className="flex flex-wrap gap-3">
              {birthdaysThisMonth.map((m) => {
                const day = parseDobDay(m.dateOfBirth!);
                const ordinal =
                  day === 1 || day === 21 || day === 31
                    ? "st"
                    : day === 2 || day === 22
                    ? "nd"
                    : day === 3 || day === 23
                    ? "rd"
                    : "th";
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-sm"
                  >
                    {m.profilePicture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.profilePicture}
                        alt={`${m.firstName} ${m.lastName}`}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-lions-blue/10 flex items-center justify-center text-sm font-bold text-lions-blue">
                        {m.firstName[0]}{m.lastName[0]}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {m.firstName} {m.lastName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {monthName} {day}{ordinal}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <MemberDirectory members={membersWithTags} filterGroups={filterGroups} />
      </div>

      <MemberDirectoryPrint members={printMembers} generatedOn={generatedOn} />
    </div>
  );
}
