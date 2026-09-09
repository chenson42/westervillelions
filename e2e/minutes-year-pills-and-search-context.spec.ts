import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { minutes, members, users, roles, userRoles } from "../src/lib/db/schema";
import { createMinutes } from "../src/lib/minutes-queries";

/**
 * Regression / verification coverage for
 * docs/work-log/2026-09-09-minutes-browse-and-search-context.md (Phase 5, qa).
 *
 * Covers the two headline defects fixed by this feature end to end through
 * the real UI, using deliberately crafted fixture minutes records so the
 * assertions don't depend on whatever the target database happens to
 * already contain (the qa work-log for this feature explicitly notes the
 * dev DB held only 1 minutes record at verification time, not the 49 the
 * work-log narrative describes — that count is production-only data):
 *
 *   1. "I couldn't tell it was search results" — browse and search must
 *      render through visibly distinct chrome.
 *   2. The 49-row wall — Lions-year pills (fiscalYear label "YYYY-YY", NOT
 *      calendar year) chunk the list, default to the current Lions year,
 *      and their counts must respect the active kind filter.
 *
 * Fixture rationale: this suite computes its "expected" pill/count numbers
 * from the database's ACTUAL pre-fixture state (queried directly, via plain
 * date-string comparison — never by calling the app's own
 * getMinutesFiscalYearCounts()/getFiscalYear(), which would make the
 * assertion tautological) plus its own known fixture rows, rather than
 * assuming a clean table. This makes the suite robust to whatever the
 * target database already contains.
 *
 * A dedicated member+user fixture is used, bound to ONLY the base 'member'
 * role (features: members.view, events.view — DECISION-041-era seed,
 * drizzle/migrations/0002_roles_permissions_groups_campaigns.sql) and
 * nothing else. This is deliberate: /members/records has no FEATURES gate
 * of its own (DECISION-077 §6) beyond proxy.ts's generic `/^\/members/`
 * rule, which the base 'member' role already satisfies via `members.view`
 * — so this fixture is the correct vehicle for confirming the page is
 * reachable by an ordinary member with no admin/board features, and that
 * `?year=` cannot widen that access, per this feature's Phase 3 Permissions
 * section.
 */

test.describe.configure({ mode: "serial" });

const RUN_ID = Date.now();
const fixtureEmail = `qa-year-pills-${RUN_ID}@example.test`;
const fixturePassword = "E2eYearPillsMember!2026";

const createdMinutesIds: string[] = [];
let fixtureUserId: string;
let fixtureMemberId: string;
let memberPage: Page;

// Search terms unique enough to never collide with real content.
const TERM_BODY = `qapillsnippetbudget${RUN_ID}`;
const TERM_MOTION = `qapillsmotionfund${RUN_ID}`;
const TERM_ACTION = `qapillsactiontask${RUN_ID}`;
const TERM_TITLE_ONLY = `qapillstitleonly${RUN_ID}`;
const TERM_WILDCARD = `qapills50%_off${RUN_ID}`;
const TERM_NONE = `qapillsnonexistentxyz${RUN_ID}`;

/** Lions FY bucket for a 'YYYY-MM-DD' date string, computed by direct string
 *  slicing — deliberately NOT the app's getFiscalYear()/Date-parsing path,
 *  so this suite's "expected" numbers are an independent check, not a
 *  reflection of the same code under test. */
function bucketFY(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7)); // 1-indexed
  return month < 7 ? year - 1 : year;
}

function shortFy(fy: number): string {
  return `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

interface Fixture {
  kind: "general" | "board";
  meetingDate: string;
  fy: number;
  title: string;
  bodyMarkdown: string;
  motions?: { text: string; moverName: string; seconderName?: string; result: string }[];
  actionItems?: { text: string; ownerName: string }[];
}

const FIXTURES: Fixture[] = [
  {
    kind: "general",
    meetingDate: "2023-08-15",
    fy: 2023,
    title: `QA Pills Fixture ${RUN_ID} — FY23 Record`,
    bodyMarkdown:
      "Routine club business for the year, nothing notable to report during this session's discussion.",
  },
  {
    kind: "general",
    meetingDate: "2024-08-10",
    fy: 2024,
    title: `QA Pills Fixture ${RUN_ID} — Body Match Record`,
    bodyMarkdown: `The treasurer discussed the ${TERM_BODY} line at length, covering revenue projections and expense categories for the upcoming quarter in detail.`,
  },
  {
    kind: "general",
    meetingDate: "2024-11-20",
    fy: 2024,
    title: `QA Pills Fixture ${RUN_ID} — Motion Match Record`,
    bodyMarkdown: "General discussion, no notable items to report this month.",
    motions: [
      {
        text: `Motion to approve the ${TERM_MOTION} expenditure for youth camp scholarships this coming year.`,
        moverName: "QA Motion Mover",
        seconderName: "QA Motion Seconder",
        result: "passed",
      },
    ],
  },
  {
    kind: "board",
    meetingDate: "2025-03-05",
    fy: 2024,
    title: `QA Pills Fixture ${RUN_ID} — Action Item Match Record`,
    bodyMarkdown: "Board discussion of ongoing matters.",
    actionItems: [
      {
        text: `Follow up on the ${TERM_ACTION} vendor contract renewal before the next scheduled meeting.`,
        ownerName: "QA Action Owner",
      },
    ],
  },
  {
    kind: "general",
    meetingDate: "2025-08-01",
    fy: 2025,
    title: `QA Pills Fixture ${TERM_TITLE_ONLY} Record`,
    bodyMarkdown: "Nothing relevant in the body content for this particular record, just routine business.",
  },
  {
    kind: "board",
    meetingDate: "2026-02-10",
    fy: 2025,
    title: `QA Pills Fixture ${RUN_ID} — Wildcard Record`,
    bodyMarkdown: `Special pricing this month: ${TERM_WILDCARD} applies to the vendor discount for members only.`,
  },
];

// Deliberately NO 'general'-kind fixture in the current fiscal year (2026) —
// this is load-bearing for the "current-FY-lands-empty" test below, which
// needs kind=general's CURRENT year to have zero rows so the
// nearest-year-with-data empty state actually renders (as opposed to
// silently falling back to the default, which is what happens for an
// OLD year with zero rows — see that test's own comment for why these are
// two different code paths).

// Baseline (pre-fixture) counts, populated in beforeAll, keyed "fy" and "kind:fy".
const baseline = new Map<string, number>();

function expectedAll(fy: number): number {
  const base = baseline.get(`all:${fy}`) ?? 0;
  const fixtureCount = FIXTURES.filter((f) => f.fy === fy).length;
  return base + fixtureCount;
}

function expectedByKind(kind: string, fy: number): number {
  const base = baseline.get(`${kind}:${fy}`) ?? 0;
  const fixtureCount = FIXTURES.filter((f) => f.fy === fy && f.kind === kind).length;
  return base + fixtureCount;
}

test.beforeAll(async ({ browser }) => {
  // Arrange — snapshot the DB's actual pre-fixture state via a plain
  // string-comparison bucketing, independent of the app's own
  // getFiscalYear()/getMinutesFiscalYearCounts() implementation.
  const existingRows = await db
    .select({ kind: minutes.kind, meetingDate: minutes.meetingDate })
    .from(minutes)
    .where(isNull(minutes.pendingDeleteAt));
  for (const row of existingRows) {
    const fy = bucketFY(row.meetingDate);
    baseline.set(`all:${fy}`, (baseline.get(`all:${fy}`) ?? 0) + 1);
    baseline.set(`${row.kind}:${fy}`, (baseline.get(`${row.kind}:${fy}`) ?? 0) + 1);
  }

  // Arrange — a disposable linked member + user bound to ONLY the base
  // 'member' role (mirrors e2e/minutes-present-count-round-trip.spec.ts's
  // established fixture pattern).
  const passwordHash = await bcrypt.hash(fixturePassword, 10);
  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  if (!memberRole) throw new Error("Fixture setup requires the 'member' role to already exist.");

  const [member] = await db
    .insert(members)
    .values({
      firstName: "QA",
      lastName: "YearPillsReader",
      email: fixtureEmail,
      membershipStatus: "active",
    })
    .returning({ id: members.id });
  fixtureMemberId = member.id;

  const [fixtureUser] = await db
    .insert(users)
    .values({
      email: fixtureEmail,
      name: "QA Year Pills Reader",
      password: passwordHash,
      role: "member",
      isActive: true,
      memberId: member.id,
    })
    .returning({ id: users.id });
  fixtureUserId = fixtureUser.id;

  await db.insert(userRoles).values({ userId: fixtureUserId, roleId: memberRole.id });

  // Arrange — the fixture minutes rows themselves.
  for (const f of FIXTURES) {
    const { id } = await createMinutes({
      kind: f.kind,
      meetingDate: f.meetingDate,
      title: f.title,
      bodyMarkdown: f.bodyMarkdown,
      authorUserId: fixtureUserId,
      motions: (f.motions ?? []).map((m) => ({ ...m, seconderName: m.seconderName ?? null })),
      actionItems: (f.actionItems ?? []).map((a) => ({ ...a, dueDate: null })),
    });
    createdMinutesIds.push(id);
  }

  // Arrange — one shared signed-in page for every test in this file
  // (mode: "serial", so no cross-test interference).
  memberPage = await browser.newPage();
  await memberPage.goto("/signin");
  await memberPage.fill('input[type="email"]', fixtureEmail);
  await memberPage.fill('input[type="password"]', fixturePassword);
  await memberPage.click('button[type="submit"]');
  await memberPage.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
});

test.afterAll(async () => {
  await memberPage?.close();
  for (const id of createdMinutesIds) {
    await db.delete(minutes).where(eq(minutes.id, id));
  }
  if (fixtureUserId) await db.delete(users).where(eq(users.id, fixtureUserId));
  if (fixtureMemberId) await db.delete(members).where(eq(members.id, fixtureMemberId));
});

test.describe("minutes year pills — browse", () => {
  test("default landing (no query params) selects the current Lions year and shows a comprehensible count", async () => {
    // Arrange
    const currentFY = bucketFY(new Date().toISOString().slice(0, 10));

    // Act
    await memberPage.goto("/members/records");

    // Assert
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(currentFY)} · ${expectedAll(currentFY)}`);

    const showing = memberPage.locator("text=/Showing \\d+ of \\d+ record/");
    await expect(showing).toContainText(`Showing ${expectedAll(currentFY)} of`);
  });

  test("clicking an older year pill re-scopes the list and marks that pill active", async () => {
    // Act
    await memberPage.goto("/members/records");
    await memberPage.getByRole("link", { name: `${shortFy(2024)} · ${expectedAll(2024)}` }).click();

    // Assert
    await expect(memberPage).toHaveURL(/year=2024/);
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(2024)} · ${expectedAll(2024)}`);
    await expect(memberPage.locator("li", { hasText: "Body Match Record" })).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Motion Match Record" })).toBeVisible();
  });

  test("kind filter composed with year filter narrows the list AND changes the pill counts to match", async () => {
    // Act — year=2024, switch to Board.
    await memberPage.goto("/members/records?year=2024");
    const kindTabs = memberPage.locator('nav[aria-label="Filter minutes by kind"]');
    await kindTabs.getByRole("link", { name: "Board" }).click();

    // Assert — only the board fixture (Action Item Match) shows, and the
    // FY2024 pill's own printed count is board-scoped, not all-kind.
    await expect(memberPage).toHaveURL(/kind=board/);
    await expect(memberPage.locator("li", { hasText: "Action Item Match Record" })).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Body Match Record" })).toHaveCount(0);
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(2024)} · ${expectedByKind("board", 2024)}`);

    // Act — switch to General, still year=2024.
    await kindTabs.getByRole("link", { name: "General" }).click();

    // Assert — counts flip to the general-scoped numbers.
    await expect(memberPage.locator("li", { hasText: "Body Match Record" })).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Motion Match Record" })).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Action Item Match Record" })).toHaveCount(0);
    await expect(activePill).toHaveText(`${shortFy(2024)} · ${expectedByKind("general", 2024)}`);
  });

  test("every rendered year pill's count matches the number of rows actually listed when clicked", async () => {
    for (const fy of [2023, 2024, 2025]) {
      // Act
      await memberPage.goto(`/members/records?year=${fy}`);

      // Assert
      const rows = memberPage.locator('ul > li a.shadow-sm[href^="/members/records/"]');
      await expect(rows).toHaveCount(expectedAll(fy));
      const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
      await expect(activePill).toHaveText(`${shortFy(fy)} · ${expectedAll(fy)}`);
    }
  });

  test("the 'All years' pill shows every record and its own count matches the rows listed", async () => {
    // Act
    await memberPage.goto("/members/records?year=all");

    // Assert
    //
    // Deliberately NOT compared against a grand total summed from the pre-suite
    // baseline. "All years" is unbounded, and under Playwright's default
    // multi-worker run other specs (e.g. minutes-present-count-round-trip) create
    // and delete `minutes` rows in the same database while this test navigates —
    // so any total captured before this request can be stale by the time the page
    // renders, and a row in a fiscal year outside [2023..2026] wouldn't be in the
    // baseline at all. That made this test fail in a full-suite run while passing
    // in isolation.
    //
    // The invariant that actually matters here — and that no concurrent writer can
    // break — is internal consistency: the pill's number and the list beneath it
    // are produced by the same request, so they must agree.
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    const rows = memberPage.locator('ul > li a.shadow-sm[href^="/members/records/"]');

    const pillCount = Number(/All years · (\d+)/.exec((await activePill.textContent()) ?? "")?.[1]);
    expect(Number.isInteger(pillCount)).toBe(true);
    await expect(rows).toHaveCount(pillCount);

    // ...and "All years" must still be a superset of every per-year bucket, so the
    // fixture records this suite created are all reachable from it.
    expect(pillCount).toBeGreaterThanOrEqual(
      [2023, 2024, 2025, 2026].reduce((sum, fy) => sum + expectedAll(fy), 0),
    );
  });

  test("an invalid ?year= value falls back to the current year without erroring, and the pill row shows no phantom selection", async () => {
    // Arrange
    const currentFY = bucketFY(new Date().toISOString().slice(0, 10));

    // Act
    const response = await memberPage.goto("/members/records?year=banana");

    // Assert
    expect(response?.status()).toBe(200);
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(currentFY)} · ${expectedAll(currentFY)}`);
  });

  test("a well-formed but dataless ?year= (1900) falls back identically to garbage input", async () => {
    // Arrange
    const currentFY = bucketFY(new Date().toISOString().slice(0, 10));

    // Act
    const response = await memberPage.goto("/members/records?year=1900");

    // Assert
    expect(response?.status()).toBe(200);
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(currentFY)} · ${expectedAll(currentFY)}`);
  });

  test("an OLD year with zero rows for the active kind silently falls back to the default, per the URL-state contract", async () => {
    // Arrange — this suite has zero 'board' fixture rows in FY2023, but
    // FY2023 is not currentFY either, so per the documented contract
    // (resolveYearParam validates against known-year-with-data, not "is it
    // plausible") this must NOT render an empty state for FY2023 — it
    // falls back to the current FY exactly like a garbage/dataless year
    // does (tests 6/7 above). The distinct "nearest year" empty state is
    // reserved for the case where the RESOLVED (current) year itself has
    // zero rows — covered by the next test.
    const currentFY = bucketFY(new Date().toISOString().slice(0, 10));

    // Act
    await memberPage.goto("/members/records?year=2023&kind=board");

    // Assert
    const activePill = memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue');
    await expect(activePill).toHaveText(`${shortFy(currentFY)} · ${expectedByKind("board", currentFY)}`);
  });

  test("the nearest-year-with-data empty state appears when the CURRENT fiscal year has zero rows for the active kind, and its link lands on real data", async () => {
    // Arrange — deliberately no 'general' fixture in the current FY (see
    // the FIXTURES array's own comment). Find the true nearest
    // general-bearing year to currentFY among this suite's own fixture
    // years, independent of the app's own nearestFiscalYearWithData().
    const currentFY = bucketFY(new Date().toISOString().slice(0, 10));
    const generalYears = [2023, 2024, 2025].filter((fy) => expectedByKind("general", fy) > 0);
    let nearest = generalYears[0];
    let bestDistance = Math.abs(nearest - currentFY);
    for (const fy of generalYears.slice(1)) {
      const distance = Math.abs(fy - currentFY);
      if (distance < bestDistance || (distance === bestDistance && fy > nearest)) {
        nearest = fy;
        bestDistance = distance;
      }
    }

    // Act — kind=general, no year param, so it resolves to currentFY.
    await memberPage.goto("/members/records?kind=general");

    // Assert — comprehensible empty state, not a bare "posted yet" message.
    await expect(
      memberPage.locator(`text=No General minutes recorded yet for ${shortFy(currentFY)}.`),
    ).toBeVisible();
    // Regression guard (found during this feature's own Phase 5
    // verification, 2026-09-09): the link's rendered text must have a real
    // space between the fiscal year and "instead" — confirmed via
    // server-rendered HTML (not just a Playwright accessible-name
    // normalization artifact) that it currently renders as
    // "View 2025-26instead →" with the words glued together. This is
    // exactly the class of bug the codebase's own `{" "}` JSX-whitespace
    // idiom exists to prevent (139 other call sites use it; this file
    // itself correctly uses it one paragraph above, at the "…minutes
    // recorded yet for{" "}" line) — this one link was missed. Asserting
    // the exact, correctly-spaced text here (not a whitespace-tolerant
    // regex) so this test fails until the glued-text bug is fixed.
    const link = memberPage.getByRole("link", { name: `View ${shortFy(nearest)} instead →` });
    await expect(link).toBeVisible();

    // Act — follow the link.
    await link.click();

    // Assert — lands on real general data for that year.
    await expect(memberPage).toHaveURL(new RegExp(`year=${nearest}`));
    const rows = memberPage.locator('ul > li a.shadow-sm[href^="/members/records/"]');
    await expect(rows).toHaveCount(expectedByKind("general", nearest));
  });

  test("deep-linking and browser back/forward across year params both restore the right view", async () => {
    // Act
    await memberPage.goto("/members/records?year=2025");
    await expect(
      memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue'),
    ).toHaveText(`${shortFy(2025)} · ${expectedAll(2025)}`);

    await memberPage.goto("/members/records?year=2023");
    await expect(
      memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue'),
    ).toHaveText(`${shortFy(2023)} · ${expectedAll(2023)}`);

    // Act — back should restore the FY2025 view.
    await memberPage.goBack();

    // Assert
    await expect(memberPage).toHaveURL(/year=2025/);
    await expect(
      memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue'),
    ).toHaveText(`${shortFy(2025)} · ${expectedAll(2025)}`);

    // Act — forward should restore the FY2023 view.
    await memberPage.goForward();

    // Assert
    await expect(memberPage).toHaveURL(/year=2023/);
    await expect(
      memberPage.locator('nav[aria-label="Filter minutes by fiscal year"] a.bg-lions-blue'),
    ).toHaveText(`${shortFy(2023)} · ${expectedAll(2023)}`);
  });
});

test.describe("minutes search — visibly distinct from browsing", () => {
  test("searching renders 'Results for…' chrome, a count, Clear search, and hides the year pills entirely", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_BODY)}`);

    // Assert
    const heading = memberPage.locator("h2", { hasText: "Results for" });
    await expect(heading).toBeVisible();
    expect(await heading.textContent()).toContain(TERM_BODY);
    await expect(memberPage.locator("text=1 result")).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Clear search" })).toBeVisible();
    await expect(memberPage.locator('nav[aria-label="Filter minutes by fiscal year"]')).toHaveCount(0);
    // Kind tabs must still be visible in search mode.
    await expect(memberPage.locator('nav[aria-label="Filter minutes by kind"]')).toBeVisible();
  });

  test("a body-text match shows a 'Matched in Minutes text' label with the highlighted term", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_BODY)}`);

    // Assert
    await expect(memberPage.locator("text=Matched in Minutes text")).toBeVisible();
    const mark = memberPage.locator("mark", { hasText: new RegExp(TERM_BODY, "i") });
    await expect(mark).toBeVisible();
  });

  test("a motion-text match shows a 'Matched in Motion' label", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_MOTION)}`);

    // Assert
    await expect(memberPage.locator("text=Matched in Motion")).toBeVisible();
    await expect(memberPage.locator("mark", { hasText: new RegExp(TERM_MOTION, "i") })).toBeVisible();
  });

  test("an action-item match shows a 'Matched in Action item' label", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_ACTION)}`);

    // Assert
    await expect(memberPage.locator("text=Matched in Action item")).toBeVisible();
    await expect(memberPage.locator("mark", { hasText: new RegExp(TERM_ACTION, "i") })).toBeVisible();
  });

  test("a title-only match shows NO 'Matched in' label and no highlighted snippet — by design", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_TITLE_ONLY)}`);

    // Assert — the result renders, but with no match-context block at all.
    await expect(memberPage.locator("li", { hasText: TERM_TITLE_ONLY })).toBeVisible();
    await expect(memberPage.locator("text=Matched in")).toHaveCount(0);
    await expect(memberPage.locator("mark")).toHaveCount(0);
  });

  test("a search term containing ILIKE wildcards (%, _) is treated literally, not as a SQL wildcard", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_WILDCARD)}`);

    // Assert — exactly the one fixture record that literally contains this
    // string, not every record in the table (which is what an unescaped
    // ILIKE '%...%' with a live '%'/'_' would match).
    await expect(memberPage.locator("text=1 result")).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Wildcard Record" })).toBeVisible();
  });

  test("a zero-result search shows the empty-search copy, not the browse empty state", async () => {
    // Act
    await memberPage.goto(`/members/records?q=${encodeURIComponent(TERM_NONE)}`);

    // Assert
    await expect(memberPage.locator("text=0 results")).toBeVisible();
    await expect(memberPage.locator(`text=No minutes match “${TERM_NONE}”.`)).toBeVisible();
  });

  test("Clear search returns to the year/kind that was active before searching, not the default", async () => {
    // Act — establish a non-default browse state, then search, then clear.
    await memberPage.goto("/members/records?year=2024&kind=general");
    await memberPage.locator("#minutes-search-q").fill(TERM_BODY);
    await memberPage.getByRole("button", { name: "Search" }).click();
    await expect(memberPage).toHaveURL(/q=/);
    await memberPage.getByRole("link", { name: "Clear search" }).click();

    // Assert — back in browse mode, with year=2024&kind=general restored.
    await expect(memberPage).toHaveURL(/year=2024/);
    await expect(memberPage).toHaveURL(/kind=general/);
    await expect(memberPage).not.toHaveURL(/q=/);
    await expect(memberPage.locator("li", { hasText: "Body Match Record" })).toBeVisible();
    await expect(memberPage.locator("li", { hasText: "Action Item Match Record" })).toHaveCount(0);
  });
});

test.describe("minutes records — access and layout", () => {
  test("a member with only the base 'member' role (no admin/board features) reaches every year/kind/search combination", async () => {
    // Act / Assert — this fixture user holds ONLY 'member' (members.view,
    // events.view — no admin.dashboard, no board features). Every prior
    // test in this file already exercised this account across every
    // year/kind/search combination without a redirect to /access-pending;
    // this test additionally confirms the page never renders the
    // "Account Not Linked" state for it (it IS linked) and that no
    // FEATURES-gated content is required to see the list.
    const response = await memberPage.goto("/members/records?year=2024&kind=board&q=");
    expect(response?.status()).toBe(200);
    await expect(memberPage.locator("text=Account Not Linked")).toHaveCount(0);
    await expect(memberPage.locator("text=Club Records")).toBeVisible();
  });

  test("an unauthenticated request to /members/records redirects to /signin", async ({ browser }) => {
    // Arrange
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Act
    await anonPage.goto("/members/records?year=2024");

    // Assert
    await expect(anonPage).toHaveURL(/\/signin/);
    await anonContext.close();
  });

  test("at 360px the kind tabs, search box, and year pills wrap without any horizontal page overflow", async () => {
    // Arrange
    await memberPage.setViewportSize({ width: 360, height: 800 });

    // Act
    await memberPage.goto("/members/records");

    // Assert — no horizontal scrollbar on the page itself.
    const overflow = await memberPage.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // Assert — every filter control still meets the 44px tap-target floor.
    const controls = memberPage.locator(
      'nav[aria-label="Filter minutes by fiscal year"] a, nav[aria-label="Filter minutes by kind"] a',
    );
    const count = await controls.count();
    for (let i = 0; i < count; i++) {
      const box = await controls.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43); // allow 1px rounding
    }

    // Restore default viewport for any tests that might run after this one.
    await memberPage.setViewportSize({ width: 1280, height: 800 });
  });
});

