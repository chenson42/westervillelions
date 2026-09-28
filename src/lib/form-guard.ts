/**
 * Anti-abuse checks for the three anonymous public forms (contact, newsletter
 * subscribe, membership application) — public-form spam hardening,
 * docs/work-log/2026-09-28-public-form-spam.md, DECISION-104 (Revision 2).
 *
 * Three independent pieces, per the 2026-09-28 architectural review's
 * module-boundary ruling (still one file; register imports NONE of it):
 *   - `evaluateStructuralGuard()` — pure, honeypot + timing only. No DB, no fetch.
 *   - `evaluateContentGuard()` / `isGibberishToken()` — pure, content only.
 *     No DB, no fetch.
 *   - `checkAndRecordFormCooldown()` — DB-touching. Its `@/lib/db` /
 *     `@/lib/db/schema` imports are DYNAMIC (`await import(...)`), not
 *     static top-of-file imports — this is deliberate (DECISION-104 Revision
 *     2 / Phase 5 QA finding): a static top-level `import { db } from
 *     "@/lib/db"` here gets transitively pulled in by anything that imports
 *     only `isGibberishToken()` (scripts/purge-form-spam.ts), and ES import
 *     hoisting evaluates that import — and `@/lib/db`'s module-level
 *     `postgres(url)` connection, which reads `process.env.DATABASE_URL` —
 *     BEFORE the importing script's own `dotenv.config()` call ever runs,
 *     regardless of where `config()` is textually placed. Keeping this
 *     module's top-level, statically-imported surface DB-free makes that bug
 *     structurally impossible to reintroduce by accident. Do not "clean this
 *     up" back to a static import.
 *
 * `/api/auth/register` deliberately imports NEITHER of these — it keeps its
 * existing, intentionally visible 400/403 responses. Do not import this
 * module from register.
 */

export const FORM_GUARD_TIMING_FLOOR_MS = 3000; // Phase 1 recommendation
export const FORM_GUARD_COOLDOWN_WINDOW_MS = 2 * 60_000; // Phase 1 recommendation, 2 minutes

// --- Content signal (DECISION-104, Revision 2) ------------------------------
//
// isGibberishToken() combines FOUR independent measures and fires when at
// least TWO of them independently agree. A single vowel-ratio cutoff was
// tried first (Revision 1) and found, via a production dry-run, to recover
// only 5 of 16 known-incident rows: English's alphabet is ~19.2% vowels (5 of
// 26 letters), so a 20% cutoff has almost no margin against that natural
// baseline and is close to a coin flip against genuinely random letter
// strings. The four-signal combination below was calibrated directly against
// production data (read-only) and a stress test of real, unusual surnames —
// see DECISION-104 and the Phase 3 Revision 2 work-log section for the full
// method, the numbers, and the rejected trigram-based fifth signal.

export const FORM_GUARD_MIN_ALPHA_LENGTH = 4;
export const FORM_GUARD_VOWEL_RATIO_MAX = 0.2; // vowels / alphabetic chars, a/e/i/o/u only — NOT y
export const FORM_GUARD_CASE_TRANSITIONS_MIN = 2; // lowercase→uppercase transitions inside one token
export const FORM_GUARD_BIGRAM_SCORE_MAX = 0.45; // fraction of adjacent letter-pairs in COMMON_BIGRAMS
export const FORM_GUARD_CONSONANT_RUN_MIN = 6; // longest run of consecutive non-vowel letters

// Embedded literal constant — top 150 English letter-bigrams by document
// frequency across /usr/share/dict/words (i.e., "what fraction of English
// words contain this pair at least once"), generated once during the
// DECISION-104 Revision 2 calibration pass and pasted in literally below. Do
// NOT regenerate this at runtime from a filesystem dictionary —
// /usr/share/dict/words does not exist on Vercel. If this list is ever
// regenerated, re-run the full calibration described in DECISION-104 against
// production data before shipping a new one — it is load-bearing for the
// false-positive guarantee documented there, not a cosmetic tuning knob.
export const COMMON_BIGRAMS = new Set([
  "er", "in", "ti", "te", "on", "al", "an", "at", "ic", "en", "is", "ra", "re", "le", "ri", "ro",
  "st", "ne", "ar", "li", "es", "or", "nt", "un", "it", "la", "co", "io", "ia", "ni", "ca", "to",
  "ed", "us", "ta", "ly", "tr", "ss", "ma", "de", "ch", "ou", "lo", "ng", "el", "ph", "na", "ac",
  "ol", "di", "om", "he", "me", "si", "no", "et", "th", "ll", "se", "mi", "pe", "op", "os", "id",
  "ve", "hi", "il", "ce", "ho", "ea", "as", "ul", "pr", "nd", "ha", "ab", "ur", "ot", "bl", "po",
  "mo", "nc", "pa", "ec", "em", "oc", "ge", "og", "am", "sh", "ci", "ap", "ct", "pi", "sc", "su",
  "ns", "hy", "da", "ry", "so", "um", "ad", "sa", "ep", "sp", "rt", "sm", "do", "ty", "bi", "od",
  "ag", "cr", "ut", "be", "gi", "ba", "iv", "im", "ip", "cu", "ga", "pl", "ke", "rm", "gr", "tu",
  "ae", "oo", "iz", "ir", "ig", "lu", "mp", "if", "eo", "vi", "oi", "bo", "gl", "fi", "br", "ie",
  "ee", "ru", "ai", "rc", "ov", "fo",
]);

/**
 * Gibberish iff at least TWO of these four independent measures fire (see
 * DECISION-104 Revision 2 for the calibration behind each threshold):
 *   - vowel ratio (a/e/i/o/u only, never `y`) <= 20%
 *   - >= 2 lowercase→uppercase transitions inside the token
 *   - bigram-plausibility score < 45% against COMMON_BIGRAMS
 *   - longest consecutive non-vowel ("consonant") run >= 6
 *
 * A value with any internal whitespace, or whose alphabetic-only length is
 * under 4, is never evaluated (always false) — too short/shaped-like-a-
 * sentence to judge.
 *
 * Exported standalone (see DECISION-104) so scripts/purge-form-spam.ts can
 * reuse the exact same per-field rule for retroactive selection. Never
 * reimplement this elsewhere. This function has NO import of `@/lib/db` —
 * keep it that way (see the module doc comment above).
 */
export function isGibberishToken(value: string | null | undefined): boolean {
  if (!value) return false;
  if (/\s/.test(value.trim())) return false; // has a space — never evaluated
  const alpha = value.replace(/[^a-zA-Z]/g, "");
  if (alpha.length < FORM_GUARD_MIN_ALPHA_LENGTH) return false;
  const lower = alpha.toLowerCase();

  const vowelRatio = (alpha.match(/[aeiou]/gi) ?? []).length / alpha.length; // a/e/i/o/u, NOT y

  let caseTransitions = 0;
  for (let i = 1; i < alpha.length; i++) {
    if (alpha[i - 1] >= "a" && alpha[i - 1] <= "z" && alpha[i] >= "A" && alpha[i] <= "Z") {
      caseTransitions++;
    }
  }

  let bigramHits = 0;
  for (let i = 0; i < lower.length - 1; i++) {
    if (COMMON_BIGRAMS.has(lower.slice(i, i + 2))) bigramHits++;
  }
  const bigramScore = lower.length > 1 ? bigramHits / (lower.length - 1) : 1;

  let consonantRun = 0;
  let maxConsonantRun = 0;
  for (const ch of lower) {
    if ("aeiou".includes(ch)) {
      consonantRun = 0;
    } else {
      consonantRun++;
      maxConsonantRun = Math.max(maxConsonantRun, consonantRun);
    }
  }

  const fired = [
    vowelRatio <= FORM_GUARD_VOWEL_RATIO_MAX,
    caseTransitions >= FORM_GUARD_CASE_TRANSITIONS_MIN,
    bigramScore < FORM_GUARD_BIGRAM_SCORE_MAX,
    maxConsonantRun >= FORM_GUARD_CONSONANT_RUN_MIN,
  ].filter(Boolean).length;

  return fired >= 2;
}

// --- Structural guard: honeypot + timing only (no content, no DB) ----------

export type StructuralGuardReason = "honeypot" | "timing";

export interface StructuralGuardInput {
  /** Raw value of the hidden honeypot field. Missing/undefined/whitespace-only = empty = never trips. */
  honeypot?: string | null;
  /** Client Date.now() captured on the form's mount. Missing/undefined = timing check skipped (neutral). */
  renderedAt?: number | null;
}

export interface StructuralGuardVerdict {
  allow: boolean;
  reason: StructuralGuardReason | null;
}

function honeypotTripped(honeypot?: string | null): boolean {
  return typeof honeypot === "string" && honeypot.trim().length > 0;
}

function timingTripped(renderedAt?: number | null): boolean {
  if (renderedAt === undefined || renderedAt === null) return false;
  // Non-production bypass, per the 2026-09-28 architectural review ruling 5 —
  // matches the existing IS_DEV Turnstile-widget-bypass precedent already in
  // these three client components. pnpm test:e2e runs against `pnpm dev`, so
  // this covers Playwright without any test-only surface.
  if (process.env.NODE_ENV !== "production") return false;
  return Date.now() - renderedAt < FORM_GUARD_TIMING_FLOOR_MS;
}

/**
 * Pure. No DB, no fetch, no content inspection whatsoever — honeypot and
 * timing only. Split out from the old single `evaluateFormGuard()` verdict
 * (DECISION-104 Revision 2) so the cooldown check can run between this and
 * `evaluateContentGuard()`, unconditional on content.
 */
export function evaluateStructuralGuard(input: StructuralGuardInput): StructuralGuardVerdict {
  if (honeypotTripped(input.honeypot)) {
    return { allow: false, reason: "honeypot" };
  }
  if (timingTripped(input.renderedAt)) {
    return { allow: false, reason: "timing" };
  }
  return { allow: true, reason: null };
}

// --- Content guard: the two-field gibberish-agreement rule -----------------

export interface ContentGuardVerdict {
  /** false iff at least two of the given textFields independently test gibberish. */
  allow: boolean;
  /**
   * Count of textFields entries that independently matched isGibberishToken().
   * A single gibberish field never flips `allow` to false on its own — see
   * DECISION-104.
   */
  gibberishFieldCount: number;
}

/**
 * Pure. No DB, no fetch. Free-text fields to run the gibberish heuristic
 * over (caller picks which columns — see the per-route field lists in the
 * design doc). Null/undefined/empty entries are skipped, never flagged.
 */
export function evaluateContentGuard(
  textFields: (string | null | undefined)[],
): ContentGuardVerdict {
  const gibberishFieldCount = textFields.filter((field) => isGibberishToken(field)).length;
  return { allow: gibberishFieldCount < 2, gibberishFieldCount };
}

// --- Cross-form cooldown (DB-touching) --------------------------------------

/**
 * DB-touching, separate from the pure functions above. Normalizes email (trim
 * + lowercase, same normalization newsletter/subscribe already applies),
 * checks for a form_submission_cooldown row for that email newer than the
 * window; if none, inserts one and opportunistically deletes rows older than
 * the window (no cron/standing job).
 *
 * Call site moved earlier in the route pipeline as of DECISION-104 Revision
 * 2: this now runs right after `evaluateStructuralGuard()` passes, BEFORE
 * `evaluateContentGuard()` — recording an attempt means "this looked like a
 * real human filling a real form" (honeypot+timing), not "...AND their
 * content also passed." This is what actually recovers most of the recall
 * this feature exists for; see DECISION-104 for the full reasoning.
 *
 * Imports `@/lib/db` / `@/lib/db/schema` dynamically (not at module top
 * level) — see this file's top doc comment for why. Do not hoist these back
 * to static imports.
 */
export async function checkAndRecordFormCooldown(
  email: string,
): Promise<{ withinCooldown: boolean }> {
  const [{ db }, { formSubmissionCooldown }, { and, eq, gt, lt }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
    import("drizzle-orm"),
  ]);

  const normalized = email.trim().toLowerCase();
  const cutoff = new Date(Date.now() - FORM_GUARD_COOLDOWN_WINDOW_MS);

  const recent = await db
    .select({ id: formSubmissionCooldown.id })
    .from(formSubmissionCooldown)
    .where(
      and(
        eq(formSubmissionCooldown.email, normalized),
        gt(formSubmissionCooldown.createdAt, cutoff),
      ),
    )
    .limit(1);

  if (recent.length > 0) {
    return { withinCooldown: true };
  }

  await db.insert(formSubmissionCooldown).values({ email: normalized });

  // Opportunistic prune — no cron/standing job for this small table.
  await db.delete(formSubmissionCooldown).where(lt(formSubmissionCooldown.createdAt, cutoff));

  return { withinCooldown: false };
}
