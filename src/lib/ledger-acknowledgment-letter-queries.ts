/**
 * Acknowledgment / Thank-You Letter Generation — DB layer (DECISION-072 §3,
 * DECISION-073, 2026-08-08).
 *
 * Two responsibilities, kept separate:
 *   - listGeneratableAcknowledgments() / getLetterTemplate() — reads.
 *   - updateLetterTemplate() / generateAcknowledgmentLetters() — writes,
 *     each wrapped in its own db.transaction().
 *
 * Deliberately NOT added to ledger-queries.ts (5,000+ lines, already
 * flagged as the file every new feature is kept out of) and NOT added to
 * ledger-category-queries.ts (unrelated domain) — continues the
 * DECISION-049/061/062/065/069 sibling-module lineage.
 *
 * generateAcknowledgmentLetters() is the ONLY caller of
 * composeAcknowledgmentLetter() in the write path — this file never
 * assembles letter text itself, it only hydrates rows, decides
 * skip-vs-generate, and persists the composer's output.
 */

import { db } from "@/lib/db";
import {
  ledgerAcknowledgments,
  ledgerTransactions,
  ledgerEntities,
  ledgerCategories,
  ledgerDonors,
  ledgerLetterTemplates,
  ledgerAuditLog,
  type LedgerLetterTemplate,
  type NewLedgerLetterTemplate,
} from "@/lib/db/schema";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import { composeAcknowledgmentLetter } from "@/lib/ledger-acknowledgment-letter";

// ---------------------------------------------------------------------------
// listGeneratableAcknowledgments
// ---------------------------------------------------------------------------

export type GeneratableAcknowledgmentRow = {
  ackId: string;
  donationTxnId: string;
  /**
   * Read straight off the stored row without narrowing — a corrupted/legacy
   * value is possible in principle, and generateAcknowledgmentLetters()'s
   * "unrecognized acknowledgment type" guard is what actually enforces the
   * enum, not this type. See deriveAckType() in ./ledger for the one place
   * that DECIDES written_ack_250 vs quid_pro_quo_75 — this module never
   * re-derives it.
   */
  type: string;
  amountCents: number;
  txnDate: string;
  quidProQuoValueCents: number | null;
  quidProQuoDescription: string | null;
  sentAt: Date | null;
  donor: { id: string; name: string; address: string | null } | null;
  entity: { id: string; name: string; ein: string | null; taxClassification: string };
  // false when the txn has no category (safer default, matches
  // listPendingAcknowledgments()'s own "include it" default).
  categoryAckNotRequired: boolean;
};

/**
 * Candidate rows for the letter-generation screen.
 *
 * Two distinct modes, one query shape (no second, differently-shaped query
 * for the write path — DECISION-072 §4):
 *
 *  - No `opts.ackIds` (the batch-select screen's initial load): filtered to
 *    `sentAt IS NULL` AND category `ackNotRequired` is not true — the
 *    treasurer should never even see a checkbox for a row generation would
 *    refuse.
 *  - `opts.ackIds` given (generateAcknowledgmentLetters()'s internal call):
 *    returns EXACTLY the requested rows, unfiltered by sentAt/ackNotRequired
 *    — the caller needs to see a sent/excluded row's real state in order to
 *    report the SPECIFIC skip reason ("already sent" vs "category excluded
 *    from acknowledgments") rather than a generic "not generatable". A
 *    requested id that doesn't exist at all is simply absent from the
 *    returned array; the caller reports "not found" for it.
 */
export async function listGeneratableAcknowledgments(
  opts?: { ackIds?: string[] },
): Promise<GeneratableAcknowledgmentRow[]> {
  const scoped = opts?.ackIds !== undefined && opts.ackIds.length > 0;

  const conditions = scoped
    ? [inArray(ledgerAcknowledgments.id, opts!.ackIds!)]
    : [
        isNull(ledgerAcknowledgments.sentAt),
        // Category ackNotRequired exclusion (Guard §1a) — a transaction with
        // no category at all (categoryId IS NULL) is still admitted, matching
        // listPendingAcknowledgments()'s own "include it" default. Modeled
        // as "NOT (ackNotRequired = true)" via a left join, so a NULL
        // category row (left join miss) passes through.
      ];

  const rows = await db
    .select({
      ack: ledgerAcknowledgments,
      donor: ledgerDonors,
      entity: ledgerEntities,
      categoryAckNotRequired: ledgerCategories.ackNotRequired,
    })
    .from(ledgerAcknowledgments)
    .innerJoin(ledgerTransactions, eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.id))
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .leftJoin(ledgerDonors, eq(ledgerAcknowledgments.donorId, ledgerDonors.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .where(and(...conditions))
    .orderBy(desc(ledgerAcknowledgments.txnDate));

  const mapped = rows.map((r) => ({
    ackId: r.ack.id,
    donationTxnId: r.ack.donationTxnId,
    type: r.ack.type,
    amountCents: r.ack.amountCents,
    txnDate: r.ack.txnDate,
    quidProQuoValueCents: r.ack.quidProQuoValueCents,
    quidProQuoDescription: r.ack.quidProQuoDescription,
    sentAt: r.ack.sentAt,
    donor: r.donor ? { id: r.donor.id, name: r.donor.name, address: r.donor.address } : null,
    entity: {
      id: r.entity.id,
      name: r.entity.name,
      ein: r.entity.ein,
      taxClassification: r.entity.taxClassification,
    },
    categoryAckNotRequired: r.categoryAckNotRequired ?? false,
  }));

  // Unscoped (listing) mode: apply the ackNotRequired exclusion in code —
  // it's a LEFT JOIN, so expressing "category is missing OR
  // ackNotRequired = false" in SQL directly is equivalent to this filter,
  // but doing it here keeps the single WHERE builder above simple and
  // keeps the exact same "false = include it" default documented on the
  // field itself.
  if (!scoped) {
    return mapped.filter((row) => !row.categoryAckNotRequired);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// getLetterTemplate / updateLetterTemplate
// ---------------------------------------------------------------------------

/**
 * Returns the singleton ledger_letter_templates row. Mirrors getSettings()'s
 * fallback-default pattern (ledger-queries.ts) so a fresh dev DB before the
 * migration's seed has run still renders something sane — defaults match
 * the migration/schema seed values byte-for-byte.
 */
export async function getLetterTemplate(): Promise<LedgerLetterTemplate> {
  const rows = await db.select().from(ledgerLetterTemplates).limit(1);
  if (rows[0]) return rows[0];

  return {
    id: "00000000-0000-0000-0000-000000000000",
    greeting: "Dear {{donorName}},",
    bodyText:
      "On behalf of the Westerville Lions Club Foundation, thank you for your generous gift. " +
      "Your support helps us carry out our mission of serving the Westerville community and " +
      "beyond — from youth scholarships to hunger relief to disaster response. Gifts like yours " +
      "make that work possible.",
    closing: "With gratitude,",
    signatureName: "",
    signatureTitle: "Treasurer, Westerville Lions Club Foundation",
    updatedByUserId: null,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

/**
 * The ENTIRE allowlist updateLetterTemplate() (and the PATCH route above
 * it) will ever read from a caller-supplied patch object — this is the
 * compliance boundary (DECISION-072 §2), enforced structurally: any other
 * key present on `patch` (even if a caller bypasses TypeScript, e.g. via
 * `as any`) is simply never read, because the loop below only ever indexes
 * these five field names.
 */
const LETTER_TEMPLATE_FIELDS = [
  "greeting",
  "bodyText",
  "closing",
  "signatureName",
  "signatureTitle",
] as const;

export type LetterTemplatePatch = Partial<
  Pick<NewLedgerLetterTemplate, (typeof LETTER_TEMPLATE_FIELDS)[number]>
>;

/**
 * Updates the singleton template row and writes one ledger_audit_log row
 * per call, atomically. Re-reads the row inside the transaction so
 * before/after reflect the freshest state at write time, computes
 * only-the-changed-fields diffs, and skips the audit write entirely when
 * the patch turns out to be a no-op — mirrors updateCategory()'s exact
 * shape (ledger-category-queries.ts).
 */
export async function updateLetterTemplate(
  patch: LetterTemplatePatch,
  actorUserId: string | null,
): Promise<LedgerLetterTemplate> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ledgerLetterTemplates).limit(1);
    if (!existing) {
      // Should not happen post-migration — the singleton row is seeded by
      // 0076_ledger_letter_templates.sql, guaranteed the same way
      // ledgerSettings' singleton row is guaranteed. Fail loudly rather
      // than silently fabricate a row here.
      throw new Error("ledger_letter_templates singleton row not found");
    }

    const setValues: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const field of LETTER_TEMPLATE_FIELDS) {
      const value = patch[field];
      if (value !== undefined && value !== existing[field]) {
        setValues[field] = value;
        before[field] = existing[field];
        after[field] = value;
      }
    }

    if (Object.keys(setValues).length === 0) {
      // Recognized field(s) present but nothing actually changed — no
      // write, no audit row.
      return existing;
    }

    setValues.updatedAt = new Date();
    setValues.updatedByUserId = actorUserId;

    const [updated] = await tx
      .update(ledgerLetterTemplates)
      .set(setValues)
      .where(eq(ledgerLetterTemplates.id, existing.id))
      .returning();

    await tx.insert(ledgerAuditLog).values({
      actorUserId: actorUserId ?? null,
      action: "ack_letter_template_updated",
      targetCategoryId: null,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// generateAcknowledgmentLetters
// ---------------------------------------------------------------------------

export type GenerateLetterResult =
  | { ackId: string; status: "generated"; letterText: string }
  | { ackId: string; status: "skipped"; reason: string };

const KNOWN_ACK_TYPES = new Set(["written_ack_250", "quid_pro_quo_75"]);

/**
 * Batch/single generation — a batch of one IS a single generation, no
 * second code path (DECISION-072 §4). Skip-vs-write is decided by a
 * deterministic pre-check for every requested id BEFORE db.transaction()
 * opens; only rows that pass are written, all inside ONE transaction — a
 * business-rule skip can never abort another row's write, only a genuine
 * DB error inside the transaction rolls back the whole batch.
 *
 * Guard order (Phase 3 design doc, §Guards):
 *   1. not found                                  — id not among hydrated rows
 *   2. already sent                                — sentAt !== null (DECISION-073 item 2:
 *      hard refusal, never a silent overwrite of a sent letter's historical record)
 *   3. category excluded from acknowledgments      — fresh JOIN re-check, not
 *      inherited from queue-membership-at-creation-time (Guard §1b)
 *   4. no donor linked
 *   5. donor missing address
 *   6. unrecognized acknowledgment type             — enum sanity check only;
 *      the below-threshold guard is deliberately NOT re-derived here
 *      (DECISION-073 item 3 — that decision belongs solely to ack-creation
 *      time / deriveAckType(), re-deriving here could reject a legitimate
 *      manual typeOverride)
 *   7. generated
 */
export async function generateAcknowledgmentLetters(
  ackIds: string[],
): Promise<GenerateLetterResult[]> {
  const rows = await listGeneratableAcknowledgments({ ackIds });
  const rowsById = new Map(rows.map((r) => [r.ackId, r]));
  const template = await getLetterTemplate();

  const results: GenerateLetterResult[] = [];
  const toWrite: { ackId: string; letterText: string }[] = [];

  for (const ackId of ackIds) {
    const row = rowsById.get(ackId);

    if (!row) {
      results.push({ ackId, status: "skipped", reason: "not found" });
      continue;
    }
    if (row.sentAt !== null) {
      results.push({ ackId, status: "skipped", reason: "already sent" });
      continue;
    }
    if (row.categoryAckNotRequired) {
      results.push({
        ackId,
        status: "skipped",
        reason: "category excluded from acknowledgments",
      });
      continue;
    }
    if (!row.donor) {
      results.push({ ackId, status: "skipped", reason: "no donor linked" });
      continue;
    }
    if (!row.donor.address || row.donor.address.trim().length === 0) {
      results.push({ ackId, status: "skipped", reason: "donor missing address" });
      continue;
    }
    if (!KNOWN_ACK_TYPES.has(row.type)) {
      results.push({ ackId, status: "skipped", reason: "unrecognized acknowledgment type" });
      continue;
    }

    const letterText = composeAcknowledgmentLetter({
      entity: row.entity,
      donor: { name: row.donor.name, address: row.donor.address },
      ack: {
        type: row.type as "written_ack_250" | "quid_pro_quo_75",
        amountCents: row.amountCents,
        txnDate: row.txnDate,
        quidProQuoValueCents: row.quidProQuoValueCents,
        quidProQuoDescription: row.quidProQuoDescription,
      },
      template: {
        greeting: template.greeting,
        bodyText: template.bodyText,
        closing: template.closing,
        signatureName: template.signatureName,
        signatureTitle: template.signatureTitle,
      },
    });

    results.push({ ackId, status: "generated", letterText });
    toWrite.push({ ackId, letterText });
  }

  if (toWrite.length > 0) {
    await db.transaction(async (tx) => {
      for (const { ackId, letterText } of toWrite) {
        await tx
          .update(ledgerAcknowledgments)
          .set({ letterText, updatedAt: new Date() })
          .where(eq(ledgerAcknowledgments.id, ackId));
      }
    });
  }

  return results;
}
