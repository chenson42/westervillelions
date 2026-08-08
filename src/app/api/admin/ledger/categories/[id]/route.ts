/**
 * PATCH /api/admin/ledger/categories/[id]
 *
 * Ledger Category Management (2026-08-07 / DECISION-065/066) — one
 * general-purpose "edit this category" endpoint covering rename,
 * countsAsGiving, form990Line, and isActive. Deliberately NOT a one-way
 * POST .../deactivate route — categories don't have the multi-guard state
 * machine that justifies transactions/[id]/{approve,reject,split} being
 * separate routes, so treating isActive as an ordinary PATCH field makes
 * reactivation (isActive: true) free at the API layer (architect Ruling #3).
 *
 * Gate: LEDGER_MANAGE
 *
 * Body — any non-empty subset of:
 * { name?: string; countsAsGiving?: boolean; form990Line?: string | null; isActive?: boolean }
 *
 * Validation, in order (Phase 3 contract):
 *   1. 404 if category doesn't exist.
 *   2. If `name` present: trim, reject empty (400), reject over
 *      MAX_CATEGORY_NAME_LENGTH (400), case-insensitive collision scoped to
 *      (entityId, fundKind, flow) EXCLUDING this category's own id (409). No
 *      lock check — Treasurer Decision 1 explicitly allows renaming a
 *      category a locked year references.
 *   3. If `form990Line` present: null/"" (after trim) stores NULL; otherwise
 *      trim and reject over MAX_FORM_990_LINE_LENGTH (400).
 *   4. If `countsAsGiving` present: must be boolean (400 otherwise).
 *   5. If `isActive` present: must be boolean (400 otherwise). No block
 *      either direction — deactivate/reactivate are both unconditional here;
 *      the open-balance warning is surfaced by GET .../impact before the
 *      call, never a server-side block.
 *   6. If no recognized field is present in the body: 400 "No fields to update."
 *
 * On success: one UPDATE ledger_categories (only changed columns +
 * updatedAt) + one ledgerAuditLog insert, in the same transaction
 * (updateCategory(), ledger-category-queries.ts). Audit action precedence
 * (DECISION-066 item 6): name changed -> category_renamed; else isActive
 * false->true -> category_reactivated; else isActive true->false ->
 * category_deactivated; else (flags only) -> category_flags_updated.
 * before/after always capture EVERY changed field regardless of which
 * action name wins.
 *
 * Response 200: updated LedgerCategoryDTO.
 * Errors: 400 (validation, or empty body); 401; 403; 404; 409 (name collision).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getCategories } from "@/lib/ledger-queries";
import {
  getCategoryById,
  updateCategory,
  toCategoryDTO,
  type CategoryUpdatePatch,
} from "@/lib/ledger-category-queries";
import { validateCategoryEditInput, MAX_FORM_990_LINE_LENGTH } from "@/lib/ledger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await getCategoryById(id);
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, countsAsGiving, form990Line, isActive } = body ?? {};

    const hasRecognizedField =
      name !== undefined ||
      countsAsGiving !== undefined ||
      form990Line !== undefined ||
      isActive !== undefined;
    if (!hasRecognizedField) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const patch: CategoryUpdatePatch = {};

    if (name !== undefined) {
      if (typeof name !== "string") {
        return NextResponse.json({ error: "name must be a string" }, { status: 400 });
      }
      const siblings = await getCategories(existing.entityId, {
        fundKind: existing.fundKind,
        flow: existing.flow,
      });
      const existingNames = siblings.filter((c) => c.id !== id).map((c) => c.name);
      const validation = validateCategoryEditInput({ name, existingNames });
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: validation.status });
      }
      patch.name = validation.trimmedName;
    }

    if (form990Line !== undefined) {
      if (form990Line !== null && typeof form990Line !== "string") {
        return NextResponse.json({ error: "form990Line must be a string or null" }, { status: 400 });
      }
      const trimmed = typeof form990Line === "string" ? form990Line.trim() : "";
      if (trimmed.length > MAX_FORM_990_LINE_LENGTH) {
        return NextResponse.json(
          { error: `form990Line must be ${MAX_FORM_990_LINE_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      patch.form990Line = trimmed ? trimmed : null;
    }

    if (countsAsGiving !== undefined) {
      if (typeof countsAsGiving !== "boolean") {
        return NextResponse.json({ error: "countsAsGiving must be a boolean" }, { status: 400 });
      }
      patch.countsAsGiving = countsAsGiving;
    }

    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
      }
      patch.isActive = isActive;
    }

    const result = await updateCategory(id, patch, session.user.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(toCategoryDTO(result.category));
  } catch (error) {
    console.error("Error updating ledger category:", error);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}
