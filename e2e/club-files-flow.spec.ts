import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  users,
  roles,
  userRoles,
  members,
  events,
  clubFiles,
  clubFileUploadSessions,
  clubFileUploadChunks,
} from "../src/lib/db/schema";
import { deleteClubFile } from "../src/lib/club-files-queries";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Phase 5 (qa) verification coverage for
 * docs/work-log/2026-09-04-club-documents.md.
 *
 * Drives the real "sponsorship packet" use case end to end through the
 * actual browser client (real chunked-upload hook, real fetch/PUT calls),
 * not a hand-rolled script that bypasses it, then proves the two boundaries
 * Phase 1's adversarial pass and Phase 3's design doc both called out as the
 * ones a happy-path click-through can't catch:
 *
 *  - visibility (public vs members-only) is enforced by the DOWNLOAD ROUTE
 *    on every request, not by the UI simply not linking to a private file
 *    — a members-only file must 404 (never 403/401) for a signed-out
 *    caller and must not even be listed on the public event page, while a
 *    signed-in linked member gets both the listing and the bytes.
 *  - club_files.manage is admin-only by deliberate role binding (this
 *    work-log's User Decision, migration 0098) — a board_member account
 *    (which holds plenty of OTHER admin.dashboard-gated pages) must not
 *    see the nav entry, reach /admin/club-files, or get anything but 403
 *    from its API.
 *
 * Also exercises upload robustness (a real >3MB PDF spanning three
 * 3,145,728-byte chunks; a spoofed-extension non-PDF rejected by
 * server-side magic-byte validation with the form fields preserved; an
 * abandoned upload session swept by the next init call once >24h old) and
 * replace-in-place (new bytes, same row, same visibility/attachment).
 */

const PASSWORD = "E2eClubFilesGate!2026";
const RUN_ID = Date.now();
const MEMBER_EMAIL = `qa-club-files-member-${RUN_ID}@example.test`;
const BOARD_MEMBER_EMAIL = `qa-club-files-board-${RUN_ID}@example.test`;

let memberUserId: string | undefined;
let memberMemberId: string | undefined;
let boardMemberUserId: string | undefined;
let fixtureEventId: string | undefined;

let publicFileId: string | undefined;
let membersOnlyFileId: string | undefined;

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Fixture PDF construction — structurally valid PDFs built at runtime (no
// binary fixtures checked into the repo). `marker` varies the content-stream
// operator's operands so two files of the same target size still hash
// differently, and `qpdf --check` (run manually while authoring this spec)
// confirmed this shape parses as a real, non-corrupt PDF.
// ---------------------------------------------------------------------------
function buildValidPdf(targetBytes: number, marker = "0.20 0.40 0.80"): Buffer {
  const line = Buffer.from(`${marker} rg 50 50 20 20 re f\n`);
  const contentTarget = Math.max(targetBytes - 2000, line.length);
  const parts: Buffer[] = [];
  let size = 0;
  while (size < contentTarget) {
    parts.push(line);
    size += line.length;
  }
  const contentStream = Buffer.concat(parts);

  const obj1 = "<< /Type /Catalog /Pages 2 0 R >>";
  const obj2 = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  const obj3 =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
    "/Resources << /Font << /F1 5 0 R >> >> >>";
  const obj5 = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  const chunks: Buffer[] = [];
  const offsets: Record<number, number> = {};
  let pos = 0;

  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
  chunks.push(header);
  pos += header.length;

  function addObj(num: number, body: string) {
    offsets[num] = pos;
    const buf = Buffer.from(`${num} 0 obj\n${body}\nendobj\n`);
    chunks.push(buf);
    pos += buf.length;
  }

  addObj(1, obj1);
  addObj(2, obj2);
  addObj(3, obj3);

  offsets[4] = pos;
  const streamHeader = Buffer.from(`4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n`);
  const streamFooter = Buffer.from("\nendstream\nendobj\n");
  const obj4 = Buffer.concat([streamHeader, contentStream, streamFooter]);
  chunks.push(obj4);
  pos += obj4.length;

  addObj(5, obj5);

  const xrefStart = pos;
  const n = 6;
  const xrefLines: Buffer[] = [Buffer.from("xref\n"), Buffer.from(`0 ${n}\n`), Buffer.from("0000000000 65535 f \n")];
  for (let i = 1; i < n; i++) {
    xrefLines.push(Buffer.from(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`));
  }
  chunks.push(Buffer.concat(xrefLines));

  chunks.push(Buffer.from(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));

  return Buffer.concat(chunks);
}

function buildFakePdf(): Buffer {
  // Real JPEG magic bytes (SOI + APP0/JFIF + EOI), padded, wearing a .pdf
  // extension and application/pdf content-type at the form layer — the
  // spoofed-extension shape server-side magic-byte validation must catch.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00", "binary"),
    Buffer.from([0xff, 0xd9]),
    Buffer.alloc(2000, 0),
  ]);
}

const LARGE_PDF_NAME = `QA Large Multi-Chunk Packet ${RUN_ID}.pdf`;
const LARGE_PDF = buildValidPdf(8_000_000, "0.20 0.40 0.80"); // ~7.6MB, spans 3 x 3MB chunks
const LARGE_PDF_SHA256 = crypto.createHash("sha256").update(LARGE_PDF).digest("hex");

const MEMBERS_ONLY_PDF_NAME = `QA Members-Only Boundary File ${RUN_ID}.pdf`;
const MEMBERS_ONLY_PDF = buildValidPdf(50_000, "0.90 0.10 0.10"); // single chunk

const REPLACEMENT_PDF = buildValidPdf(60_000, "0.05 0.75 0.55"); // single chunk, distinct bytes
const REPLACEMENT_PDF_SHA256 = crypto.createHash("sha256").update(REPLACEMENT_PDF).digest("hex");

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

async function cookieHeaderFor(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  const boardMemberRole = await db.query.roles.findFirst({ where: eq(roles.name, "board_member") });
  if (!memberRole || !boardMemberRole) {
    throw new Error("Fixture setup requires the 'member' and 'board_member' roles — run `pnpm db:migrate` first.");
  }

  const [memberRow] = await db
    .insert(members)
    .values({ firstName: "QA", lastName: "Club Files Gate Fixture", email: MEMBER_EMAIL, isActive: true })
    .returning({ id: members.id });
  memberMemberId = memberRow.id;

  const [memberUser] = await db
    .insert(users)
    .values({
      email: MEMBER_EMAIL,
      name: "QA Club Files Member Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
      memberId: memberMemberId,
    })
    .returning({ id: users.id });
  memberUserId = memberUser.id;
  await db.insert(userRoles).values({ userId: memberUserId, roleId: memberRole.id });

  const [boardUser] = await db
    .insert(users)
    .values({
      email: BOARD_MEMBER_EMAIL,
      name: "QA Club Files Board Member Fixture (no club_files.manage)",
      password: passwordHash,
      role: "board_member",
      isActive: true,
    })
    .returning({ id: users.id });
  boardMemberUserId = boardUser.id;
  await db.insert(userRoles).values({ userId: boardMemberUserId, roleId: boardMemberRole.id });

  // A real, public event to attach files to — the driving "sponsorship
  // packet on the event page" use case.
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const wallClock = future.toISOString().slice(0, 19).replace("T", " ");
  const [fixtureEvent] = await db
    .insert(events)
    .values({
      title: `QA Club Files Gate Fixture Event ${RUN_ID}`,
      startDate: wallClock,
      isPublic: true,
      isRecurring: false,
    })
    .returning({ id: events.id });
  fixtureEventId = fixtureEvent.id;
});

test.afterAll(async () => {
  if (publicFileId) await deleteClubFile(publicFileId).catch(() => {});
  if (membersOnlyFileId) await deleteClubFile(membersOnlyFileId).catch(() => {});

  // Sweep any orphaned upload sessions this run created (the >24h sweep test
  // manipulates timestamps directly; clean up regardless of whether the
  // sweep assertion ran).
  if (fixtureEventId) {
    const sessions = await db.query.clubFileUploadSessions.findMany({
      where: (s, { like }) => like(s.filename, "qa-club-files-orphan-%"),
    });
    for (const s of sessions) {
      await db.delete(clubFileUploadChunks).where(eq(clubFileUploadChunks.sessionId, s.id));
      await db.delete(clubFileUploadSessions).where(eq(clubFileUploadSessions.id, s.id));
    }
  }

  if (fixtureEventId) {
    await db.delete(events).where(eq(events.id, fixtureEventId));
  }
  for (const id of [memberUserId, boardMemberUserId]) {
    if (id) {
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  if (memberMemberId) {
    await db.delete(members).where(eq(members.id, memberMemberId));
  }
});

// ---------------------------------------------------------------------------
// 1. Driving use case: admin uploads a real multi-chunk PDF, marks it
//    public, attaches it to an event; a signed-out visitor downloads it with
//    byte-identical content and correct headers.
// ---------------------------------------------------------------------------
test.describe("driving use case: public sponsorship packet, end to end", () => {
  test("admin uploads a >3MB PDF (3 chunks), marks it Public, attaches it to an event", async ({ page }) => {
    test.setTimeout(120_000);

    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/club-files");

    // Act — real file input, real form, real chunked-upload hook driving
    // three actual PUT requests plus finalize.
    await page.setInputFiles("#club-file-input", {
      name: "rudolph-run-sponsorship-packet.pdf",
      mimeType: "application/pdf",
      buffer: LARGE_PDF,
    });
    await page.fill("#club-file-name", LARGE_PDF_NAME);
    await page.locator('input[name="visibility"][value="public"]').check();
    await page.getByRole("button", { name: "Upload" }).click();

    // Assert — upload succeeds (progress reaches 100%, success toast shown).
    await expect(page.getByText("File uploaded")).toBeVisible({ timeout: 90_000 });

    // Act — open the new file's detail page to capture its id and attach it
    // to the fixture event via the real searchable picker.
    await page.getByRole("link", { name: LARGE_PDF_NAME }).click();
    await page.waitForURL(/\/admin\/club-files\/[0-9a-f-]+$/);
    publicFileId = page.url().split("/").pop()!;

    await page.fill("#event-attach-search", `QA Club Files Gate Fixture Event ${RUN_ID}`);
    await page.getByText(`QA Club Files Gate Fixture Event ${RUN_ID}`).click();
    await page.getByRole("button", { name: "Save attachments" }).click();
    await expect(page.getByText("Event attachments saved")).toBeVisible({ timeout: 10_000 });

    // Assert — the row it uploaded from is durable server-side.
    const row = await db.query.clubFiles.findFirst({ where: eq(clubFiles.id, publicFileId) });
    expect(row?.visibility).toBe("public");
    expect(row?.byteSize).toBe(LARGE_PDF.length);
  });

  test("a signed-out visitor sees the download on the public event page and gets byte-identical bytes with correct headers", async ({
    browser,
  }) => {
    // Arrange
    expect(publicFileId, "previous test must have set publicFileId").toBeTruthy();
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Act
    await anonPage.goto(`/events/${fixtureEventId}`);
    await expect(anonPage.getByText("Downloads")).toBeVisible();
    await expect(anonPage.getByText(LARGE_PDF_NAME)).toBeVisible();

    const res = await anonPage.request.get(`/api/club-files/${publicFileId}/download`);

    // Assert
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(/^inline; filename="/);
    const body = await res.body();
    expect(body.length).toBe(LARGE_PDF.length);
    expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(LARGE_PDF_SHA256);

    await anonContext.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Visibility boundary, live.
// ---------------------------------------------------------------------------
test.describe("visibility boundary: members-only file", () => {
  test("admin uploads a members-only file and attaches it to the same event", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/club-files");

    // Act
    await page.setInputFiles("#club-file-input", {
      name: "board-briefing.pdf",
      mimeType: "application/pdf",
      buffer: MEMBERS_ONLY_PDF,
    });
    await page.fill("#club-file-name", MEMBERS_ONLY_PDF_NAME);
    await page.locator('input[name="visibility"][value="members-only"]').check();
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("File uploaded")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: MEMBERS_ONLY_PDF_NAME }).click();
    await page.waitForURL(/\/admin\/club-files\/[0-9a-f-]+$/);
    membersOnlyFileId = page.url().split("/").pop()!;

    await page.fill("#event-attach-search", `QA Club Files Gate Fixture Event ${RUN_ID}`);
    await page.getByText(`QA Club Files Gate Fixture Event ${RUN_ID}`).click();
    await page.getByRole("button", { name: "Save attachments" }).click();
    await expect(page.getByText("Event attachments saved")).toBeVisible({ timeout: 10_000 });
  });

  test("signed-out download of the members-only file 404s — never 403/401", async ({ browser }) => {
    // Arrange
    expect(membersOnlyFileId, "previous test must have set membersOnlyFileId").toBeTruthy();
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Act
    const res = await anonPage.request.get(`/api/club-files/${membersOnlyFileId}/download`);

    // Assert
    expect(res.status()).toBe(404);
    await anonContext.close();
  });

  test("the members-only file is absent from the public event page while signed out, but the public file is still present", async ({
    browser,
  }) => {
    // Arrange
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    // Act
    await anonPage.goto(`/events/${fixtureEventId}`);

    // Assert
    await expect(anonPage.getByText(LARGE_PDF_NAME)).toBeVisible();
    await expect(anonPage.getByText(MEMBERS_ONLY_PDF_NAME)).toHaveCount(0);
    await anonContext.close();
  });

  test("a signed-in linked member sees both files on the event page and can download the members-only one", async ({
    browser,
  }) => {
    // Arrange
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, MEMBER_EMAIL);

    // Act — /members/events/[id] redirects to the same /events/[id] page,
    // which now scopes its query by session.user.memberId.
    await memberPage.goto(`/members/events/${fixtureEventId}`);
    await memberPage.waitForURL(`**/events/${fixtureEventId}`);

    // Assert — page lists both.
    await expect(memberPage.getByText(LARGE_PDF_NAME)).toBeVisible();
    await expect(memberPage.getByText(MEMBERS_ONLY_PDF_NAME)).toBeVisible();

    // Assert — the members-only file's bytes are actually reachable now.
    const cookieHeader = await cookieHeaderFor(memberPage);
    const res = await memberPage.request.get(`/api/club-files/${membersOnlyFileId}/download`, {
      headers: { cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(
      crypto.createHash("sha256").update(MEMBERS_ONLY_PDF).digest("hex"),
    );

    await memberContext.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Upload robustness.
// ---------------------------------------------------------------------------
test.describe("upload robustness", () => {
  test("a spoofed .pdf that is really a JPEG is rejected at finalize, with an inline error and the form fields preserved", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/club-files");
    const fakeName = `QA Fake PDF Rejection Test ${RUN_ID}`;

    // Act
    await page.setInputFiles("#club-file-input", {
      name: "definitely-not-a-pdf.pdf",
      mimeType: "application/pdf",
      buffer: buildFakePdf(),
    });
    await page.fill("#club-file-name", fakeName);
    await page.getByRole("button", { name: "Upload" }).click();

    // Assert — inline error, exact server copy, never a generic toast.
    await expect(page.getByText("This isn't a valid PDF file")).toBeVisible({ timeout: 20_000 });

    // Assert — Phase 1 Flow 1's field-preserving requirement: the name the
    // admin typed is still there, not cleared.
    await expect(page.locator("#club-file-name")).toHaveValue(fakeName);

    // Assert — no durable row was ever created for the rejected upload.
    const created = await db.query.clubFiles.findFirst({ where: eq(clubFiles.name, fakeName) });
    expect(created).toBeUndefined();
  });

  test("an abandoned upload session (init + one chunk, never finalized) leaves no orphan once it's >24h old and a later init sweeps it", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/club-files"); // just to hold an authenticated context
    const cookieHeader = await cookieHeaderFor(page);
    const orphanFilename = `qa-club-files-orphan-${RUN_ID}.pdf`;

    // Act — init a session and PUT exactly one chunk, then walk away
    // (no finalize call at all).
    const initRes = await page.request.post("/api/admin/club-files/upload-sessions", {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { filename: orphanFilename, declaredSize: 500_000 },
    });
    expect(initRes.status()).toBe(200);
    const { sessionId } = await initRes.json();

    const chunkRes = await page.request.put(`/api/admin/club-files/upload-sessions/${sessionId}/chunks/0`, {
      headers: { cookie: cookieHeader },
      data: Buffer.alloc(500_000, 1),
    });
    expect(chunkRes.status()).toBe(200);

    // Assert — the session and its chunk exist right now.
    expect(await db.query.clubFileUploadSessions.findFirst({ where: eq(clubFileUploadSessions.id, sessionId) })).toBeTruthy();
    expect(
      (await db.query.clubFileUploadChunks.findMany({ where: eq(clubFileUploadChunks.sessionId, sessionId) })).length,
    ).toBe(1);

    // Act — simulate the session having sat untouched for >24h (the
    // documented sweep window), then trigger any later init call.
    await db
      .update(clubFileUploadSessions)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(clubFileUploadSessions.id, sessionId));

    const sweepTriggerRes = await page.request.post("/api/admin/club-files/upload-sessions", {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { filename: `qa-club-files-orphan-trigger-${RUN_ID}.pdf`, declaredSize: 1000 },
    });
    expect(sweepTriggerRes.status()).toBe(200);
    const { sessionId: triggerSessionId } = await sweepTriggerRes.json();

    // Assert — the stale session and its chunk row are both gone (cascade),
    // with no cron and no background job, exactly per DECISION-095.
    expect(await db.query.clubFileUploadSessions.findFirst({ where: eq(clubFileUploadSessions.id, sessionId) })).toBeUndefined();
    expect(
      (await db.query.clubFileUploadChunks.findMany({ where: eq(clubFileUploadChunks.sessionId, sessionId) })).length,
    ).toBe(0);

    // Cleanup this test's own trigger session (it's fresh/'uploading', not
    // swept by anything else in this run).
    await db.delete(clubFileUploadSessions).where(eq(clubFileUploadSessions.id, triggerSessionId));
  });
});

// ---------------------------------------------------------------------------
// 4. Replace-in-place.
// ---------------------------------------------------------------------------
test.describe("replace-in-place", () => {
  test("replacing the public file's bytes serves the new content while name/visibility/attachment survive", async ({
    page,
  }) => {
    // Arrange
    expect(publicFileId, "requires the driving-use-case test to have run first").toBeTruthy();
    await signInAsAdmin(page);
    await page.goto(`/admin/club-files/${publicFileId}`);

    // Act
    await page.setInputFiles("#club-file-replace-input", {
      name: "rudolph-run-sponsorship-packet-v2.pdf",
      mimeType: "application/pdf",
      buffer: REPLACEMENT_PDF,
    });
    await page.getByRole("button", { name: "Replace file" }).click();
    await expect(page.getByText("File replaced")).toBeVisible({ timeout: 20_000 });

    // Assert — same row, same metadata, new bytes.
    const row = await db.query.clubFiles.findFirst({ where: eq(clubFiles.id, publicFileId!) });
    expect(row?.name).toBe(LARGE_PDF_NAME);
    expect(row?.visibility).toBe("public");
    expect(row?.byteSize).toBe(REPLACEMENT_PDF.length);
    await expect(page.getByText("Attached to 1 event")).toBeVisible();

    // Assert — the download route now serves the NEW bytes at the SAME url.
    const res = await page.request.get(`/api/club-files/${publicFileId}/download`);
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(REPLACEMENT_PDF_SHA256);

    // Assert — the event page still shows it (attachment survived the swap).
    await page.goto(`/events/${fixtureEventId}`);
    await expect(page.getByText(LARGE_PDF_NAME)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Permission boundary: club_files.manage is admin-only (migration 0098);
//    a board_member holds admin.dashboard (reaches /admin generally) but
//    must not reach Club Files anywhere.
// ---------------------------------------------------------------------------
test.describe("permission boundary: board_member (holds admin.dashboard, not club_files.manage)", () => {
  test("does not see the Club Files nav entry on /admin", async ({ page }) => {
    // Arrange
    await signIn(page, BOARD_MEMBER_EMAIL);

    // Act
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/admin");
    await expect(page.getByRole("link", { name: "Club Files" })).toHaveCount(0);
  });

  test("is redirected off /admin/club-files", async ({ page }) => {
    // Arrange
    await signIn(page, BOARD_MEMBER_EMAIL);

    // Act
    await page.goto("/admin/club-files");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).not.toContain("/admin/club-files");
  });

  test("gets 403, not a silent 200, from GET /api/admin/club-files", async ({ page }) => {
    // Arrange
    await signIn(page, BOARD_MEMBER_EMAIL);
    const cookieHeader = await cookieHeaderFor(page);

    // Act
    const res = await page.request.get("/api/admin/club-files", { headers: { cookie: cookieHeader } });

    // Assert
    expect(res.status()).toBe(403);
  });

  test("gets 403 from the upload-session init route too", async ({ page }) => {
    // Arrange
    await signIn(page, BOARD_MEMBER_EMAIL);
    const cookieHeader = await cookieHeaderFor(page);

    // Act
    const res = await page.request.post("/api/admin/club-files/upload-sessions", {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { filename: "nope.pdf", declaredSize: 1000 },
    });

    // Assert
    expect(res.status()).toBe(403);
  });
});
