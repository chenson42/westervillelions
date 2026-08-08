/**
 * PATCH /api/admin/ledger/acknowledgments/letter-template
 *
 * Acknowledgment / Thank-You Letter Generation (DECISION-072/073,
 * 2026-08-08). Gate: LEDGER_MANAGE — stricter than LEDGER_RECORD (used for
 * generate/preview/print) because a template edit reshapes every future
 * letter, club-wide, not one record.
 *
 * Edits the singleton `ledger_letter_templates` row. PATCH semantics — all
 * fields optional, at least one required.
 *
 * Body:
 * {
 *   greeting?: string;
 *   bodyText?: string;
 *   closing?: string;
 *   signatureName?: string;
 *   signatureTitle?: string;
 * }
 *
 * This object IS THE ENTIRE ALLOWLIST — this is the compliance boundary
 * (DECISION-072 §2), not an implementation detail. Any other key in the
 * request body is ignored, not written, not echoed back as an error —
 * there is no code path from an unexpected key to a written column,
 * because updateLetterTemplate() only ever reads these five field names off
 * the patch object it's given.
 *
 * Each provided field must be a string (empty string allowed — an empty
 * greeting is the treasurer's choice, not a validation failure) under a
 * 4,000-char cap (paragraphs, not novels — guards a paste-in accident, not
 * a real editorial constraint).
 *
 * Response 200: { template: LedgerLetterTemplate }
 * Response 400: validation error or no recognized fields provided
 * Response 401: not authenticated
 * Response 403: lacks LEDGER_MANAGE
 * Response 500: server error
 *
 * Writes one ledger_audit_log row per call with action:
 * 'ack_letter_template_updated', before/after holding only the fields that
 * actually changed (matches the category-audit convention exactly).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  updateLetterTemplate,
  type LetterTemplatePatch,
} from "@/lib/ledger-acknowledgment-letter-queries";

const MAX_FIELD_LENGTH = 4000;

// The entire allowlist — see the compliance-boundary note above. Nothing
// outside this list is ever read from the request body.
const ALLOWED_FIELDS = [
  "greeting",
  "bodyText",
  "closing",
  "signatureName",
  "signatureTitle",
] as const;

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const patch: LetterTemplatePatch = {};

    for (const field of ALLOWED_FIELDS) {
      const value = body?.[field];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
      }
      if (value.length > MAX_FIELD_LENGTH) {
        return NextResponse.json(
          { error: `${field} must be ${MAX_FIELD_LENGTH} characters or fewer` },
          { status: 400 },
        );
      }
      patch[field] = value;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "At least one field must be provided for update" },
        { status: 400 },
      );
    }

    const template = await updateLetterTemplate(patch, session.user.id);

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error updating acknowledgment letter template:", error);
    return NextResponse.json(
      { error: "Failed to update acknowledgment letter template" },
      { status: 500 },
    );
  }
}
