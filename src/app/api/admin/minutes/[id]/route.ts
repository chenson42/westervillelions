/**
 * GET /api/admin/minutes/[id] — full detail for the edit form, INCLUDING
 * soft-deleted rows (an admin restoring a record needs to see it).
 * Gate: minutes.manage. 404 if the id doesn't exist at all.
 *
 * PATCH /api/admin/minutes/[id] — single endpoint, mutually exclusive
 * `action` in the body (mirrors
 * src/app/api/admin/ledger/reimbursements/[id]/route.ts's PATCH-with-
 * action-body convention):
 *
 *   update: { action: 'update', kind?, eventId?, meetingDate?, title?,
 *     presentCount?, notetakerMemberId?, bodyMarkdown?, motions?, actionItems? }
 *     Gate: minutes.manage. 409 if status !== 'draft' ("Reopen this record
 *     before editing"). motions/actionItems arrays, when present, fully
 *     REPLACE the existing child rows (delete-then-reinsert inside a DB
 *     transaction) — unchanged from the original design.
 *
 *     presentCount is a plain scalar column update — DECISION-079
 *     (Phase 4 loop-back, 2026-08-09, superseding DECISION-078). Attendance
 *     is a single headcount on the minutes row itself, not a per-member
 *     roster; there is no child table to replace or merge, and therefore no
 *     way to lose a row by omission — the earlier per-member design (and
 *     the data-loss defect DECISION-078 fixed in it) no longer exists. See
 *     src/lib/minutes-queries.ts's updateMinutesDraft() for the full
 *     contract.
 *
 *     notetakerMemberId (further Phase 4 increment, 2026-08-09) is the
 *     notetaker OF RECORD — who took the minutes, distinct from
 *     authorUserId (data-entry attribution, never displayed). Omitted key
 *     leaves it unchanged; null/"" clears it; a string is resolved against
 *     `members` via getMemberNameSnapshot() and snapshotted at this exact
 *     write — never trust a client-supplied name for an FK'd field. 400 if
 *     the id doesn't resolve to an existing member.
 *
 *   approve: { action: 'approve' }
 *     Gate: minutes.manage. Requires status='draft', else 409. Sets
 *     status='approved', approvedByUserId, approvedAt.
 *
 *   reopen: { action: 'reopen' }
 *     Gate: minutes.manage. Requires status='approved', else 409. Sets
 *     status='draft'. Does NOT clear approvedByUserId/approvedAt
 *     (DECISION-077 §8) — a subsequent approve overwrites them.
 *
 * DELETE /api/admin/minutes/[id] — soft-delete. Gate: minutes.delete. Sets
 * pendingDeleteAt = now(). Idempotent (already-deleted returns 200, not an
 * error).
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 "API Contract".
 *
 * Responses: 200 { id } success; 400 validation; 401 unauthenticated; 403
 * forbidden; 404 not found; 409 state conflict.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isValidMinutesKind, isValidMotionResult } from "@/lib/minutes";
import {
  getMinutesById,
  getMinutesDetail,
  updateMinutesDraft,
  approveMinutes,
  reopenMinutes,
  softDeleteMinutes,
  getMemberNameSnapshot,
  type MotionInput,
  type ActionItemInput,
  type UpdateMinutesInput,
} from "@/lib/minutes-queries";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX_LEN = 200;
const BODY_MAX_LEN = 50_000;
const MOTION_TEXT_MAX_LEN = 2_000;
const NAME_MAX_LEN = 200;
const ACTION_TEXT_MAX_LEN = 2_000;
// Sanity ceiling, not a real club-size limit — see POST /api/admin/minutes's
// own copy of this constant.
const PRESENT_COUNT_MAX = 1_000;

function isValidDate(raw: unknown): raw is string {
  return typeof raw === "string" && DATE_REGEX.test(raw) && !isNaN(new Date(raw + "T00:00:00").getTime());
}

// Same shape-validation as POST /api/admin/minutes — duplicated rather than
// imported from a shared app/api helper, matching this codebase's existing
// per-route validation convention (e.g. the reimbursements route's own
// local parseDate()/VALID_PAYMENT_METHODS). The actual enum-membership
// checks (isValidMinutesKind, isValidMotionResult) ARE centralized in
// src/lib/minutes.ts — only this JSON-shape boilerplate is per-route.

/** DECISION-079 — a single headcount, not a per-member roster. `null`
 *  clears a previously-recorded count. */
function parsePresentCount(raw: unknown): number | null | string {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > PRESENT_COUNT_MAX) {
    return `presentCount must be a whole number between 0 and ${PRESENT_COUNT_MAX}, or null`;
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
// GET
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const detail = await getMinutesDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "Minutes record not found" }, { status: 404 });
    }
    return NextResponse.json({ minutes: detail });
  } catch (error) {
    console.error("Error fetching minutes:", error);
    return NextResponse.json({ error: "Failed to fetch minutes" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const action: unknown = body?.action;

    if (action !== "update" && action !== "approve" && action !== "reopen") {
      return NextResponse.json(
        { error: "action must be one of: update, approve, reopen" },
        { status: 400 },
      );
    }

    const existing = await getMinutesById(id);
    if (!existing) {
      return NextResponse.json({ error: "Minutes record not found" }, { status: 404 });
    }

    // ── update ─────────────────────────────────────────────────────────────
    if (action === "update") {
      if (existing.status !== "draft") {
        return NextResponse.json(
          { error: "Reopen this record before editing" },
          { status: 409 },
        );
      }

      const input: UpdateMinutesInput = {};

      if (body.kind !== undefined) {
        if (typeof body.kind !== "string" || !isValidMinutesKind(body.kind)) {
          return NextResponse.json({ error: "kind must be a recognized minutes kind" }, { status: 400 });
        }
        input.kind = body.kind;
      }

      if (body.eventId !== undefined) {
        const eventId = body.eventId === null || body.eventId === "" ? null : body.eventId;
        if (eventId !== null && typeof eventId !== "string") {
          return NextResponse.json({ error: "eventId must be a string or null" }, { status: 400 });
        }
        input.eventId = eventId;
      }

      if (body.meetingDate !== undefined) {
        if (!isValidDate(body.meetingDate)) {
          return NextResponse.json(
            { error: "meetingDate must be a valid date in YYYY-MM-DD format" },
            { status: 400 },
          );
        }
        input.meetingDate = body.meetingDate;
      }

      if (body.title !== undefined) {
        input.title =
          typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, TITLE_MAX_LEN) : null;
      }

      if (body.bodyMarkdown !== undefined) {
        input.bodyMarkdown = typeof body.bodyMarkdown === "string" ? body.bodyMarkdown.slice(0, BODY_MAX_LEN) : null;
      }

      if (body.presentCount !== undefined) {
        const presentCount = parsePresentCount(body.presentCount);
        if (typeof presentCount === "string") {
          return NextResponse.json({ error: presentCount }, { status: 400 });
        }
        input.presentCount = presentCount;
      }

      // Notetaker of record — omitted key = leave unchanged; null/"" =
      // clear it; a string = resolve it against `members` and snapshot the
      // current name, same server-side-resolution rule as POST
      // /api/admin/minutes (never trust a client-supplied name for an FK'd
      // field).
      if (body.notetakerMemberId !== undefined) {
        if (body.notetakerMemberId === null || body.notetakerMemberId === "") {
          input.notetakerMemberId = null;
          input.notetakerNameSnapshot = null;
        } else if (typeof body.notetakerMemberId !== "string") {
          return NextResponse.json({ error: "notetakerMemberId must be a string or null" }, { status: 400 });
        } else {
          const name = await getMemberNameSnapshot(body.notetakerMemberId);
          if (name === null) {
            return NextResponse.json(
              { error: "Selected notetaker was not found. They may have been removed." },
              { status: 400 },
            );
          }
          input.notetakerMemberId = body.notetakerMemberId;
          input.notetakerNameSnapshot = name;
        }
      }

      if (body.motions !== undefined) {
        const motions = parseMotions(body.motions);
        if (typeof motions === "string") {
          return NextResponse.json({ error: motions }, { status: 400 });
        }
        input.motions = motions;
      }

      if (body.actionItems !== undefined) {
        const actionItems = parseActionItems(body.actionItems);
        if (typeof actionItems === "string") {
          return NextResponse.json({ error: actionItems }, { status: 400 });
        }
        input.actionItems = actionItems;
      }

      const result = await updateMinutesDraft(id, input);
      if (!result.ok) {
        return NextResponse.json(
          {
            error:
              result.reason === "not_found"
                ? "Minutes record not found"
                : "Reopen this record before editing",
          },
          { status: result.reason === "not_found" ? 404 : 409 },
        );
      }
      return NextResponse.json({ id: result.id });
    }

    // ── approve ────────────────────────────────────────────────────────────
    if (action === "approve") {
      if (existing.status !== "draft") {
        return NextResponse.json(
          { error: "Minutes are not in draft status" },
          { status: 409 },
        );
      }
      const result = await approveMinutes(id, session.user.id);
      if (!result.ok) {
        return NextResponse.json(
          {
            error:
              result.reason === "not_found" ? "Minutes record not found" : "Minutes are not in draft status",
          },
          { status: result.reason === "not_found" ? 404 : 409 },
        );
      }
      return NextResponse.json({ id: result.id });
    }

    // ── reopen ─────────────────────────────────────────────────────────────
    if (existing.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved minutes can be reopened" },
        { status: 409 },
      );
    }
    const result = await reopenMinutes(id);
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.reason === "not_found" ? "Minutes record not found" : "Only approved minutes can be reopened",
        },
        { status: result.reason === "not_found" ? 404 : 409 },
      );
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error updating minutes:", error);
    return NextResponse.json({ error: "Failed to update minutes" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_DELETE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const result = await softDeleteMinutes(id);
    if (!result) {
      return NextResponse.json({ error: "Minutes record not found" }, { status: 404 });
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error deleting minutes:", error);
    return NextResponse.json({ error: "Failed to delete minutes" }, { status: 500 });
  }
}
