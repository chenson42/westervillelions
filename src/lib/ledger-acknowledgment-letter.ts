/**
 * Acknowledgment / Thank-You Letter Generation — pure composition engine
 * (DECISION-072 §2/§3, DECISION-073, 2026-08-08).
 *
 * composeAcknowledgmentLetter() is the ONLY place a letter's text is
 * assembled. It always concatenates a fixed skeleton in a fixed order:
 *
 *   template.greeting  (tokens substituted)
 *   template.bodyText  (tokens substituted)
 *   REQUIRED BLOCK      <- buildRequiredBlock(), unexported, generated fresh
 *                          from entity/ack data — no parameter, template
 *                          field, or token can reach or suppress this.
 *   template.closing   (tokens substituted)
 *   template.signatureName + template.signatureTitle (tokens substituted)
 *
 * The five `template.*` strings are the treasurer's ENTIRE writable
 * surface (mirrors ledgerLetterTemplates' column set exactly — see
 * src/lib/db/schema.ts). buildRequiredBlock() is not exported and takes
 * only `entity`/`ack` — there is no call shape in which template content
 * becomes part of the required block, or vice versa. A treasurer with full
 * write access to all five fields — including setting every one to an
 * empty string — still gets a letter whose required block is
 * byte-for-byte identical to what the same entity/ack data would produce
 * with a fully-populated template. Proven by the "empty-template fuzz
 * test" in ledger-acknowledgment-letter.test.ts (Phase 3 design doc, Unit
 * Test #7), not just asserted here.
 *
 * No DB import — this module is pure and unit-testable with
 * `environment: "node"` and no Postgres connection. Money formatting reuses
 * formatBudgetReferenceCents() from ./ledger so there's exactly one
 * cents-to-dollars convention across the ledger, not a second formatter.
 *
 * Sourced from IRS Publication 1771 ("Charitable Contributions —
 * Substantiation and Disclosure Requirements") and IRC §6115 — see the
 * Phase 3 design doc's "Composed Letter Structure" section
 * (docs/work-log/2026-08-08-acknowledgment-letter-generation.md) for the
 * required-vs-good-practice breakdown this module implements verbatim.
 */

import { formatBudgetReferenceCents } from "./ledger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComposeLetterEntity {
  name: string;
  ein: string | null;
  /** e.g. "501c3" — formatted into "501(c)(3)" for display. */
  taxClassification: string;
}

export interface ComposeLetterDonor {
  name: string;
  /**
   * NON-nullable here — the caller (generateAcknowledgmentLetters) must
   * guarantee a donor with an address before ever calling this function; see
   * the Phase 3 design doc's §Guards. Making it non-optional in the type is
   * a second, structural line of defense against calling this with an
   * unaddressed donor, not just a runtime check upstream.
   */
  address: string;
}

export interface ComposeLetterAck {
  type: "written_ack_250" | "quid_pro_quo_75";
  amountCents: number;
  /** ISO date string, 'YYYY-MM-DD'. */
  txnDate: string;
  /** Required (non-null) when type === "quid_pro_quo_75". */
  quidProQuoValueCents: number | null;
  quidProQuoDescription: string | null;
}

export interface ComposeLetterTemplate {
  greeting: string;
  bodyText: string;
  closing: string;
  signatureName: string;
  signatureTitle: string;
}

// ---------------------------------------------------------------------------
// Token substitution — allowlist per the Phase 3 design doc
// ---------------------------------------------------------------------------

/**
 * The complete token allowlist. Unknown tokens (anything matching
 * `{{...}}` not in this table — e.g. a typo like `{{doonrName}}`) are left
 * verbatim, untouched, not stripped and not a thrown error: since this
 * text lives in the editable "warmth" zone (never the required block), an
 * obviously-broken `{{...}}` string in the preview is a visible,
 * self-evidently-wrong signal the treasurer will catch before printing —
 * silently deleting it would produce a grammatically-plausible but
 * silently-wrong sentence instead, which is worse.
 */
type TokenName = "donorName" | "giftAmount" | "giftDate" | "clubName";

const TOKEN_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Escapes Markdown special characters in a SUBSTITUTED TOKEN VALUE only —
 * never in the treasurer's own template.* prose, which is allowed to use
 * real Markdown (bold/italic) intentionally. Because the composed output
 * is later rendered through react-markdown, a donor or entity name
 * containing Markdown-special characters (e.g. a donor literally named
 * "J*R* Landscaping") would otherwise have those characters interpreted as
 * emphasis markup rather than displayed literally.
 */
function escapeMarkdownValue(value: string): string {
  // Backslash included in the character class itself — replace() scans the
  // ORIGINAL string left-to-right and does not re-scan inserted
  // replacement text, so escaping "\" to "\\" first (implicitly, via this
  // single-pass regex) can't cause a newly-inserted backslash to be
  // re-escaped.
  return value.replace(/[\\*_`[\]()#]/g, (ch) => `\\${ch}`);
}

/** Substitutes the four allowlisted tokens; leaves any other `{{...}}` verbatim. */
function substituteTokens(text: string, values: Record<TokenName, string>): string {
  return text.replace(TOKEN_PATTERN, (match, tokenName: string) => {
    if (tokenName in values) {
      return escapeMarkdownValue(values[tokenName as TokenName]);
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "501c3" -> "501(c)(3)"; unrecognized input passed through unchanged. */
function formatTaxClassification(taxClassification: string): string {
  const match = /^501c(\d)$/.exec(taxClassification);
  return match ? `501(c)(${match[1]})` : taxClassification;
}

/**
 * Formats an ISO 'YYYY-MM-DD' date string as "March 3, 2026". Parses the
 * date components explicitly and constructs a local Date from them (NOT
 * `new Date(isoString)`, which parses as UTC midnight and can shift a day
 * when displayed in a US timezone) — mirrors the parseYMD/formatDate
 * convention already used elsewhere in the ledger (e.g.
 * reconciliation-match-picker.tsx, financial-report-queries.ts).
 */
function formatGiftDate(txnDate: string): string {
  const [year, month, day] = txnDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// The required block — unexported, generated fresh, unreachable from the
// template's writable surface. This is the entire IRS Pub. 1771
// substantiation content. See the Phase 3 design doc's "Composed Letter
// Structure" section for the required-vs-good-practice sourcing.
// ---------------------------------------------------------------------------

function buildRequiredBlock(entity: ComposeLetterEntity, ack: ComposeLetterAck): string {
  const taxClass = formatTaxClassification(entity.taxClassification);
  const giftDate = formatGiftDate(ack.txnDate);
  const amount = formatBudgetReferenceCents(ack.amountCents);

  // Not required by Pub. 1771's CWA content rule, but included as good
  // practice (aids the donor's own recordkeeping) — see design doc. A null
  // EIN (should not happen in production; both entities have one on file)
  // degrades gracefully rather than printing "EIN: null.".
  const einSentence = entity.ein
    ? `EIN: ${entity.ein}. Please retain this letter as your written record of this contribution for federal income tax purposes.`
    : `Please retain this letter as your written record of this contribution for federal income tax purposes.`;

  if (ack.type === "quid_pro_quo_75") {
    const fmvCents = ack.quidProQuoValueCents ?? 0;
    const fmv = formatBudgetReferenceCents(fmvCents);
    // Description of goods/services is REQUIRED content (Pub. 1771,
    // DECISION-073 item 1) — falls back to the generic phrase only when
    // quidProQuoDescription is null (legacy rows), never blocking
    // generation on its absence.
    const description = ack.quidProQuoDescription?.trim() || "goods or services";
    // Clamp to $0 — never print a negative dollar figure (edge case:
    // FMV >= amount).
    const deductibleCents = Math.max(0, ack.amountCents - fmvCents);
    const deductibleSentence =
      deductibleCents > 0
        ? `Based on our good-faith estimate of that value, ${formatBudgetReferenceCents(deductibleCents)} of your payment is tax-deductible.`
        : `Based on our good-faith estimate of that value, no portion of your payment is tax-deductible.`;

    return [
      `${entity.name} is a tax-exempt organization described in Internal Revenue Code Section ${taxClass}. This letter confirms that on ${giftDate}, ${entity.name} received a payment of ${amount} from you, in connection with providing you ${description} with an estimated fair market value of ${fmv}.`,
      `Federal tax law requires us to inform you that the amount of your payment that is deductible for federal income tax purposes is limited to the excess of the amount you paid over the value of the goods or services you received. ${deductibleSentence}`,
      einSentence,
    ].join("\n\n");
  }

  // written_ack_250 — no goods or services provided.
  return [
    `${entity.name} is a tax-exempt organization described in Internal Revenue Code Section ${taxClass}. This letter confirms that on ${giftDate}, ${entity.name} received a cash contribution of ${amount} from you.`,
    `No goods or services were provided in exchange for this contribution.`,
    einSentence,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// composeAcknowledgmentLetter — the public API
// ---------------------------------------------------------------------------

/**
 * Assembles the full letter text. Output is a single string, paragraphs
 * separated by blank lines (`\n\n`) — the same convention
 * ledger_budget_notes.notes already uses and that BudgetNotesMarkdown
 * already knows how to render as separate <p> blocks. Empty
 * template.* fields (and an empty signatureName/signatureTitle pair) are
 * simply omitted from the join rather than emitted as blank paragraphs —
 * the required block is ALWAYS present regardless.
 */
export function composeAcknowledgmentLetter(args: {
  entity: ComposeLetterEntity;
  donor: ComposeLetterDonor;
  ack: ComposeLetterAck;
  template: ComposeLetterTemplate;
}): string {
  const { entity, donor, ack, template } = args;

  const tokenValues: Record<TokenName, string> = {
    donorName: donor.name,
    giftAmount: formatBudgetReferenceCents(ack.amountCents),
    giftDate: formatGiftDate(ack.txnDate),
    clubName: entity.name,
  };

  const greeting = substituteTokens(template.greeting, tokenValues);
  const bodyText = substituteTokens(template.bodyText, tokenValues);
  const requiredBlock = buildRequiredBlock(entity, ack);
  const closing = substituteTokens(template.closing, tokenValues);
  const signatureName = substituteTokens(template.signatureName, tokenValues);
  const signatureTitle = substituteTokens(template.signatureTitle, tokenValues);

  // Signature name/title form one signature-block paragraph (name then
  // title, single newline — a conventional sign-off, not two separate
  // paragraphs) per the Phase 3 design doc's assembly order
  // ("...closing -> blank line -> signatureName -> signatureTitle").
  const signatureBlock = [signatureName, signatureTitle].filter((s) => s.length > 0).join("\n");

  return [greeting, bodyText, requiredBlock, closing, signatureBlock]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// composeAcknowledgmentEmailHtml — the send path's one new composer
// (Emailing the Donor Acknowledgment Letter, 2026-08-12, DECISION-088)
// ---------------------------------------------------------------------------

/**
 * HTML-escapes free text for embedding in the email body. Local, private
 * copy of the same four-line shape src/lib/dues-reminders.ts already has
 * for the identical class of problem (plain template/free text into an
 * HTML email) — this is that pattern's third occurrence, not a fourth
 * variant. Not imported from dues-reminders.ts: that module is
 * feature-local, not a shared utility, and reaching into a sibling
 * feature's private helper would create the wrong kind of coupling. B-46
 * tracks giving this a single shared home (src/lib/email-compose.ts) as its
 * own, separately-scoped pass — not attempted here.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wraps an already-composed letterText (verbatim — never re-derived, never
 * re-worded) into an HTML email body: one short lead-in paragraph, then the
 * letter's own paragraphs, each escaped and wrapped in <p>. Pure and
 * deterministic — no Date.now()/Math.random() dependency, same input
 * always produces byte-identical output.
 *
 * Newline convention: composeAcknowledgmentLetter()'s own doc comment
 * states its output is "paragraphs separated by blank lines (\n\n)" — this
 * function's \n\n split consumes that exact, already-documented contract,
 * not a new assumption.
 */
export function composeAcknowledgmentEmailHtml(letterText: string): string {
  const leadIn =
    "Please find your official gift acknowledgment below — you may want to save or print this " +
    "email for your tax records.";
  const paragraphs = letterText
    .split("\n\n")
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(p)}</p>`)
    .join("\n");

  return `<div style="font-family:Arial, Helvetica, sans-serif;color:#1a1a1a;font-size:14px;max-width:640px;">
<p style="margin:0 0 16px;line-height:1.5;">${leadIn}</p>
${paragraphs}
</div>`;
}
