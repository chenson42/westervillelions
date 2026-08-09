/**
 * POST /api/admin/minutes — create a draft minutes record.
 * Gate: minutes.manage.
 *
 * GET /api/admin/minutes — admin list (summary rows only — no bodyMarkdown,
 * motions, or action items; list view, not detail). Query params: kind?,
 * status?, includeDeleted? (default false).
 * Gate: minutes.manage.
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 "API Contract"; the
 * `notetakerMemberId` field is a further Phase 4 increment (2026-08-09,
 * treasurer request) — the notetaker OF RECORD, resolved to a name snapshot
 * server-side via `getMemberNameSnapshot()`, distinct from `authorUserId`.
 *
 * Responses: 201 { id } on create; 200 { minutes: [...] } on list; 400
 * validation (including an unresolvable `notetakerMemberId`); 401
 * unauthenticated; 403 forbidden.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isValidMinutesKind, isValidMotionResult } from "@/lib/minutes";
import {
  createMinutes,
  listMinutesForAdmin,
  getMemberNameSnapshot,
  type MotionInput,
  type ActionItemInput,
} from "@/lib/minutes-queries";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX_LEN = 200;
const BODY_MAX_LEN = 50_000;
const MOTION_TEXT_MAX_LEN = 2_000;
const NAME_MAX_LEN = 200;
const ACTION_TEXT_MAX_LEN = 2_000;
// Sanity ceiling, not a real club-size limit — catches a fat-fingered/garbage
// value without hardcoding this club's actual roster size anywhere.
const PRESENT_COUNT_MAX = 1_000;

function isValidDate(raw: unknown): raw is string {
  return typeof raw === "string" && DATE_REGEX.test(raw) && !isNaN(new Date(raw + "T00:00:00").getTime());
}

/**
 * Parses+validates `presentCount` — a single headcount, DECISION-079 (not a
 * per-member roster). Omitted or explicit `null` -> null (a minutes record
 * may legitimately not capture a count). Otherwise must be a non-negative
 * integer.
 */
function parsePresentCount(raw: unknown): number | null | string {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > PRESENT_COUNT_MAX) {
    return `presentCount must be a whole number between 0 and ${PRESENT_COUNT_MAX}, or omitted`;
  }
  return raw;
}

function parseMotions(raw: unknown): MotionInput[] | string {
  if (!Array.isArray(raw)) return "motions must be an array";
  const out: MotionInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return "each motion must be an object";
    const e = entry as Record<string, unknown>;
    if (typeof e.text !== "string" || !e.text.trim()) return "each motion requires non-empty text";
    if (typeof e.moverName !== "string" || !e.moverName.trim()) {
      return "each motion requires a non-empty moverName";
    }
    const result = typeof e.result === "string" && e.result.trim() ? e.result.trim() : "passed";
    if (!isValidMotionResult(result)) {
      return `motion result must be one of: passed, failed, tabled, withdrawn`;
    }
    const seconderName =
      typeof e.seconderName === "string" && e.seconderName.trim() ? e.seconderName.trim().slice(0, NAME_MAX_LEN) : null;
    out.push({
      text: e.text.trim().slice(0, MOTION_TEXT_MAX_LEN),
      moverName: e.moverName.trim().slice(0, NAME_MAX_LEN),
      seconderName,
      result,
    });
  }
  return out;
}

function parseActionItems(raw: unknown): ActionItemInput[] | string {
  if (!Array.isArray(raw)) return "actionItems must be an array";
  const out: ActionItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return "each action item must be an object";
    const e = entry as Record<string, unknown>;
    if (typeof e.text !== "string" || !e.text.trim()) return "each action item requires non-empty text";
    if (typeof e.ownerName !== "string" || !e.ownerName.trim()) {
      return "each action item requires a non-empty ownerName";
    }
    let dueDate: string | null = null;
    if (e.dueDate !== undefined && e.dueDate !== null && e.dueDate !== "") {
      if (!isValidDate(e.dueDate)) return "dueDate must be a valid YYYY-MM-DD date, or omitted";
      dueDate = e.dueDate;
    }
    out.push({
      text: e.text.trim().slice(0, ACTION_TEXT_MAX_LEN),
      ownerName: e.ownerName.trim().slice(0, NAME_MAX_LEN),
      dueDate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    const kind = body?.kind;
    if (typeof kind !== "string" || !isValidMinutesKind(kind)) {
      return NextResponse.json({ error: "kind must be a recognized minutes kind" }, { status: 400 });
    }

    const meetingDate = body?.meetingDate;
    if (!isValidDate(meetingDate)) {
      return NextResponse.json(
        { error: "meetingDate must be a valid date in YYYY-MM-DD format" },
        { status: 400 },
      );
    }

    const eventId =
      body?.eventId !== undefined && body?.eventId !== null && body?.eventId !== ""
        ? body.eventId
        : null;
    if (eventId !== null && typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId must be a string or null" }, { status: 400 });
    }

    const title =
      typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, TITLE_MAX_LEN) : null;

    const bodyMarkdown =
      typeof body?.bodyMarkdown === "string" ? body.bodyMarkdown.slice(0, BODY_MAX_LEN) : null;

    const presentCount = parsePresentCount(body?.presentCount);
    if (typeof presentCount === "string") {
      return NextResponse.json({ error: presentCount }, { status: 400 });
    }

    // Notetaker of record — a member picker, not free text (unlike
    // motions/action-items' mover/owner names). The client sends only the
    // id; the display name is resolved server-side from `members` at this
    // exact moment and snapshotted, never trusted from client-supplied text.
    const rawNotetakerMemberId = body?.notetakerMemberId;
    let notetakerMemberId: string | null = null;
    let notetakerNameSnapshot: string | null = null;
    if (rawNotetakerMemberId !== undefined && rawNotetakerMemberId !== null && rawNotetakerMemberId !== "") {
      if (typeof rawNotetakerMemberId !== "string") {
        return NextResponse.json({ error: "notetakerMemberId must be a string or null" }, { status: 400 });
      }
      const name = await getMemberNameSnapshot(rawNotetakerMemberId);
      if (name === null) {
        return NextResponse.json(
          { error: "Selected notetaker was not found. They may have been removed." },
          { status: 400 },
        );
      }
      notetakerMemberId = rawNotetakerMemberId;
      notetakerNameSnapshot = name;
    }

    const motions = parseMotions(body?.motions ?? []);
    if (typeof motions === "string") {
      return NextResponse.json({ error: motions }, { status: 400 });
    }

    const actionItems = parseActionItems(body?.actionItems ?? []);
    if (typeof actionItems === "string") {
      return NextResponse.json({ error: actionItems }, { status: 400 });
    }

    // authorUserId is always stamped from the session — never client-supplied.
    const result = await createMinutes({
      kind,
      eventId,
      meetingDate,
      title,
      presentCount,
      notetakerMemberId,
      notetakerNameSnapshot,
      bodyMarkdown,
      authorUserId: session.user.id,
      motions,
      actionItems,
    });

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating minutes:", error);
    return NextResponse.json({ error: "Failed to create minutes" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const includeDeleted = searchParams.get("includeDeleted") === "true";

    const rows = await listMinutesForAdmin({ kind, status, includeDeleted });
    return NextResponse.json({ minutes: rows });
  } catch (error) {
    console.error("Error listing minutes:", error);
    return NextResponse.json({ error: "Failed to list minutes" }, { status: 500 });
  }
}
