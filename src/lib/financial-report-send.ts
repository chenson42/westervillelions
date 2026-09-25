/**
 * "Send to Board" for the Monthly Statement of Financial Condition
 * (docs/work-log/2026-09-25-financial-report-auto-send.md, implements
 * DECISION-100/101).
 *
 * Kept as a SEPARATE file from financial-report-queries.ts, whose own
 * docblock declares it a read-only query layer — mirrors the
 * reconciliation-queries.ts / ledger-queries.ts split (DECISION-049). This
 * module is the one and only write path this feature adds; per DECISION-100
 * neither reconciliation write route (`.../sessions/[id]/close`,
 * `.../transactions/[id]/reconcile`) changes at all. "Ready to send" is
 * computed fresh, read-side, on every call — there is no cached/stored
 * "pending send" state anywhere.
 *
 * Two write operations live here:
 *   - computeTotalsFingerprint() — pure, no DB.
 *   - sendMonthlyReportToBoard() — the only function that ever inserts into
 *     financial_report_sends. Re-validates everything server-side; never
 *     trusts a client-supplied fingerprint or "ready" flag.
 *
 * listReadyToSendReports() is read-only despite living in this file (kept
 * next to the send logic it directly supports, per the Phase 3 design's own
 * file plan) — it never writes.
 */

import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  financialReportSends,
  members,
  type NewFinancialReportSend,
} from "@/lib/db/schema";
import { getEntities, getEntityById, getFunds } from "@/lib/ledger-queries";
import {
  MEMBER_EXPOSED_FUND_KINDS,
  getLatestOpenMonthForEntity,
  getMonthlyStatement,
  monthBounds,
  type MonthlyStatement,
} from "@/lib/financial-report-queries";
import { resolveTreasurer } from "@/lib/board-positions";
import { sendEmailForDurableClaim } from "@/lib/email-durable-claim";
import { escapeHtml, getAppUrl, getFromEmail } from "@/lib/email-compose";
import { BOARD_EMAIL } from "@/lib/club-contacts";

// ---------------------------------------------------------------------------
// Ship-date cutoff (DECISION-100 ruling #3: a hardcoded floor, not a seeded
// backfill migration). Months before this were never offered by this
// feature and are excluded from listReadyToSendReports() — without this, a
// day-one deploy would list every already-reconciled month in the club's
// history as "ready to send" (Phase 1 Flow 4).
// ---------------------------------------------------------------------------

export const CUTOFF_MONTH = "2026-09";

// ---------------------------------------------------------------------------
// Small pure calendar helpers (month-key iteration only — the real calendar
// math, including leap years and day-of-month validity, stays in
// financial-report-queries.ts's monthBounds()/priorMonthKey(); this file
// never re-derives it).
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function nextMonthKey(month: string): string {
  const [yStr, mStr] = month.split("-");
  let y = Number(yStr);
  let m = Number(mStr) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${pad2(m)}`;
}

function monthLabelFor(month: string): string {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (Number.isNaN(y) || Number.isNaN(m)) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatCentsForEmail(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isMemberExposedKind(kind: string): boolean {
  return (MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(kind);
}

// ---------------------------------------------------------------------------
// The Totals Fingerprint
// ---------------------------------------------------------------------------

/**
 * A SHA-256 hex digest over a FIXED, explicitly-ordered 9-field subset of
 * MonthlyStatement's totals — never `JSON.stringify(statement)` on the
 * whole object, which would fingerprint line-item/cause-line detail this
 * feature deliberately never shows the board. The fingerprint's job is:
 * would a resent summary email read differently than the one already sent?
 * It covers exactly the numbers that can appear in that summary or that the
 * "materially different" resend question needs — nothing from the
 * causeLines/category breakdown.
 *
 * Field order below is PART OF THE CONTRACT — do not reorder, and do not
 * rewrite this as a spread/`Object.keys()` walk over `statement`. Reordering
 * (or letting key order vary implicitly) changes every future fingerprint's
 * hash for rows whose totals didn't actually change, which would read as
 * "corrected" for nothing. Using a delimited template-literal string (not
 * `JSON.stringify`) sidesteps key-ordering entirely — there is only one
 * possible serialization of a template literal.
 */
export function computeTotalsFingerprint(statement: MonthlyStatement): string {
  const canonical =
    `${statement.month}|` +
    `${statement.beginningBookBalanceCents}|` +
    `${statement.endingBookBalanceCents}|` +
    `${statement.totalRevenue.oneMonthCents}|` +
    `${statement.totalExpense.oneMonthCents}|` +
    `${statement.net.oneMonthCents}|` +
    `${statement.totalRevenue.twelveMonthCents}|` +
    `${statement.totalExpense.twelveMonthCents}|` +
    `${statement.net.twelveMonthCents}|` +
    `${statement.bookVsCashDivergenceCents}`;
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Send-history lookups (read-only helpers over financial_report_sends)
// ---------------------------------------------------------------------------

type SendHistoryEntry = {
  monthEnd: string;
  sentAt: Date;
  success: boolean;
  totalsFingerprint: string;
  error: string | null;
  signedAsName: string | null;
};

/**
 * Every financial_report_sends row for an entity, newest first, with the
 * signer's name joined in for display. One query per entity, grouped in JS
 * below into "most recent attempt" and "most recent successful attempt" per
 * month — mirrors listMemberDuesStatus()/getLastRemindedMap()'s DISTINCT-ON
 * style but expressed in plain Drizzle since there's no need for raw SQL
 * here (no window function, just a JS reduce over an already-small,
 * per-entity result set).
 */
async function getSendHistoryForEntity(entityId: string): Promise<SendHistoryEntry[]> {
  const rows = await db
    .select({
      monthEnd: financialReportSends.monthEnd,
      sentAt: financialReportSends.sentAt,
      success: financialReportSends.success,
      totalsFingerprint: financialReportSends.totalsFingerprint,
      error: financialReportSends.error,
      signedAsFirstName: members.firstName,
      signedAsLastName: members.lastName,
    })
    .from(financialReportSends)
    .leftJoin(members, eq(financialReportSends.signedAsMemberId, members.id))
    .where(eq(financialReportSends.entityId, entityId))
    .orderBy(desc(financialReportSends.sentAt));

  return rows.map((r) => ({
    monthEnd: r.monthEnd,
    sentAt: r.sentAt,
    success: r.success,
    totalsFingerprint: r.totalsFingerprint,
    error: r.error,
    signedAsName: r.signedAsFirstName ? `${r.signedAsFirstName} ${r.signedAsLastName}`.trim() : null,
  }));
}

/** The most recent SUCCESSFUL send row for one (entity, month), or null. */
async function getLatestSuccessfulSend(
  entityId: string,
  monthEnd: string,
): Promise<{ totalsFingerprint: string; sentAt: Date } | null> {
  const rows = await db
    .select({ totalsFingerprint: financialReportSends.totalsFingerprint, sentAt: financialReportSends.sentAt })
    .from(financialReportSends)
    .where(
      and(
        eq(financialReportSends.entityId, entityId),
        eq(financialReportSends.monthEnd, monthEnd),
        eq(financialReportSends.success, true),
      ),
    )
    .orderBy(desc(financialReportSends.sentAt))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// listReadyToSendReports
// ---------------------------------------------------------------------------

export type ReadyToSendReport = {
  entityId: string;
  entitySlug: string;
  entityName: string;
  fundId: string;
  fundName: string;
  /** 'YYYY-MM' */
  month: string;
  /** "June 30, 2026" */
  monthEndLabel: string;
  summary: {
    endingBookBalanceCents: number;
    netOneMonthCents: number;
    netTwelveMonthCents: number;
  };
  fingerprint: string;
  /**
   * DEVIATION FROM THE PHASE 3 DESIGN DOC, noted explicitly per this
   * feature's own implementation brief: the design's type declared
   * `state: "never_sent" | "corrected"`, but its own prose two paragraphs
   * above requires a third, non-actionable case — "status-only rows:
   * already sent with a MATCHING fingerprint... returned so the page can
   * render a quiet 'sent on <date>' line... Callers filter on `state` if
   * they only want actionable rows." That filtering has nothing to filter
   * on unless the matching-fingerprint case has its own state value, so
   * this adds `"sent"` for it. `"never_sent"` and `"corrected"` are
   * unchanged from the design and ARE the actionable ones — callers should
   * do `rows.filter(r => r.state !== "sent")` to get the actionable list.
   */
  state: "never_sent" | "corrected" | "sent";
  lastSuccessfulSend: { sentAt: string; signedAsName: string | null } | null;
  lastAttemptFailed: { sentAt: string; error: string | null } | null;
};

/**
 * One row per (entity, member-exposed fund, month) from CUTOFF_MONTH
 * through that fund's latest open month (getLatestOpenMonthForEntity — the
 * gate is monotonic, so every month in between is also open). Never trusts
 * a cached "ready" flag — recomputes the statement and its fingerprint on
 * every call, so a correction made since the page last rendered surfaces
 * immediately as `state: "corrected"` on the very next load.
 *
 * An entity with zero or more than one member-exposed fund is skipped
 * entirely (today: every seeded entity has exactly one — see the schema's
 * own comment on this assumption) rather than guessed at, mirroring
 * getMonthlyStatement()'s own "never guess" posture on fund resolution.
 */
export async function listReadyToSendReports(): Promise<ReadyToSendReport[]> {
  const entities = await getEntities();
  const results: ReadyToSendReport[] = [];

  for (const entity of entities) {
    const funds = await getFunds(entity.id);
    const exposedFunds = funds.filter((f) => isMemberExposedKind(f.kind));
    if (exposedFunds.length !== 1) continue;
    const fund = exposedFunds[0];

    const latestOpenMonth = await getLatestOpenMonthForEntity(entity.id);
    if (!latestOpenMonth || latestOpenMonth < CUTOFF_MONTH) continue;

    const history = await getSendHistoryForEntity(entity.id);
    const latestRowByMonth = new Map<string, SendHistoryEntry>();
    const latestSuccessByMonth = new Map<string, SendHistoryEntry>();
    for (const row of history) {
      if (!latestRowByMonth.has(row.monthEnd)) latestRowByMonth.set(row.monthEnd, row);
      if (row.success && !latestSuccessByMonth.has(row.monthEnd)) {
        latestSuccessByMonth.set(row.monthEnd, row);
      }
    }

    let month = CUTOFF_MONTH;
    while (month <= latestOpenMonth) {
      const monthEnd = monthBounds(month).monthEnd;
      const result = await getMonthlyStatement(fund, month);
      if (result && result.status === "ready") {
        const { statement } = result;
        const fingerprint = computeTotalsFingerprint(statement);
        const lastSuccess = latestSuccessByMonth.get(monthEnd) ?? null;
        const latestAttempt = latestRowByMonth.get(monthEnd) ?? null;

        const state: ReadyToSendReport["state"] = !lastSuccess
          ? "never_sent"
          : lastSuccess.totalsFingerprint === fingerprint
            ? "sent"
            : "corrected";

        results.push({
          entityId: entity.id,
          entitySlug: entity.slug,
          entityName: entity.name,
          fundId: fund.id,
          fundName: fund.name,
          month,
          monthEndLabel: statement.monthEndLabel,
          summary: {
            endingBookBalanceCents: statement.endingBookBalanceCents,
            netOneMonthCents: statement.net.oneMonthCents,
            netTwelveMonthCents: statement.net.twelveMonthCents,
          },
          fingerprint,
          state,
          lastSuccessfulSend: lastSuccess
            ? { sentAt: lastSuccess.sentAt.toISOString(), signedAsName: lastSuccess.signedAsName }
            : null,
          lastAttemptFailed:
            latestAttempt && !latestAttempt.success
              ? { sentAt: latestAttempt.sentAt.toISOString(), error: latestAttempt.error }
              : null,
        });
      }
      month = nextMonthKey(month);
    }
  }

  return results;
}

/**
 * Count of ACTIONABLE ready-to-send rows — `state !== "sent"` — for the
 * admin nav's "Reports" badge (docs/work-log/2026-09-25-ready-to-send-badge.md,
 * B-69). A `sent` row (matching fingerprint already delivered) must never
 * count, or the badge never clears once the treasurer catches up and becomes
 * exactly the kind of permanent wallpaper this feature exists to avoid.
 *
 * DELIBERATELY reuses listReadyToSendReports() rather than a parallel "cheap
 * count" query. That function's per-month "ready" determination walks real
 * financial-gating logic (isMonthGatedForEntity's outstanding-check and
 * uncleared-deposit carve-outs, hasMonthElapsed, the totals fingerprint) —
 * re-deriving any slice of that in a second place is exactly the
 * near-financial-code duplication CLAUDE.md's 30-day code review flags
 * (a rule living in two places is two places to get it wrong), and this
 * agent's own scope-discipline rule treats a reordered check in money-
 * adjacent logic as a design decision, not a cleanup a badge should be
 * inlining.
 *
 * Cost, assessed honestly: this is NOT cheap like getFailedEmailCount()'s
 * single indexed COUNT(*) — it recomputes a full MonthlyStatement (category/
 * cause-line breakdown included) per (entity, member-exposed fund, month)
 * from CUTOFF_MONTH through each entity's latest open month, on every admin
 * page render for a LEDGER_REPORT_SEND holder. Two things keep this
 * defensible today rather than a silent performance trap:
 *   1. The gated population is tiny by construction — LEDGER_REPORT_SEND is
 *      bound narrowly (admin + treasurer), not every admin page viewer.
 *   2. The walked range is bounded by real entities (2 today) and by how far
 *      behind the treasurer has fallen since CUTOFF_MONTH (2026-09) — which
 *      is exactly the backlog this badge exists to pressure toward zero, not
 *      a value this feature lets grow unbounded on its own.
 * This IS a real unbounded-growth risk if a treasurer stops sending for many
 * months running: the badge's own query would get slower the longer the
 * problem it flags goes unaddressed. Flagged rather than silently accepted —
 * if that ever becomes real (a backlog measured in dozens of months), the
 * fix is a materialized readiness table updated on reconciliation, not a
 * second hand-rolled gating implementation here.
 */
export async function getReadyToSendReportCount(): Promise<number> {
  const rows = await listReadyToSendReports();
  return rows.filter((r) => r.state !== "sent").length;
}

// ---------------------------------------------------------------------------
// getReadyToSendReportCountCached — the stopgap (B-71 follow-up files the
// structural fix; see docs/backlog.md).
// ---------------------------------------------------------------------------

/**
 * A short-lived, per-server-instance cache around getReadyToSendReportCount(),
 * added because QA (docs/work-log/2026-09-25-ready-to-send-badge.md, Phase 5)
 * found that moving the count into the admin layout means it now runs on
 * EVERY admin page render for any FEATURES.LEDGER_REPORT_SEND holder, and
 * the underlying walk costs ~15-16 sequential DB round trips per (entity,
 * month) with no skip for already-`sent` months — ~360 round trips/render at
 * 12 elapsed months, ~720 at 24. See B-71 in docs/backlog.md for the
 * structural fix; this function is only the immediate mitigation.
 *
 * Mechanism: a plain module-level variable, not Next.js's `unstable_cache` or
 * any external store. This code runs inside a Server Component render on
 * Vercel, where each serverless/edge instance is short-lived and NOT shared
 * across concurrent requests or regions — so this cache is per-instance, not
 * global. That is fine for a nav badge (worst case: a cold instance recomputes
 * once, and different instances may briefly show slightly different counts),
 * but it is explicitly NOT a substitute for a real shared cache if this ever
 * needs cross-instance consistency. `unstable_cache` was considered and
 * rejected: it's keyed for revalidation by tags/paths tied to Next's own data
 * cache, which is more machinery than a single in-memory number needs, and it
 * would not fix the underlying round-trip cost — it would just relocate the
 * same TTL behavior implemented more simply below.
 *
 * TTL: 2 minutes. Chosen because the count only changes on two rare,
 * human-triggered events — a month becoming fully reconciled, or a treasurer
 * completing a send — never on a timer and never at high frequency. A couple
 * of minutes of staleness on a *badge* (whose entire job is "eventually catch
 * the treasurer's eye," not "be real-time") is unobservable in practice, and
 * it converts "one full recompute per admin page render" into "at most one
 * full recompute per two minutes across all admin traffic on a given
 * instance" — the single biggest real-world cost multiplier QA identified.
 *
 * Deliberately does NOT invalidate on a successful send. QA's own
 * recommendation allowed either invalidation or "just let the short TTL
 * expire" — a 2-minute window of the badge still showing a just-sent month is
 * harmless (worst case, the treasurer sees a stale "1" for up to 2 minutes
 * after sending), and skipping invalidation keeps the send path
 * (sendMonthlyReportToBoard()) completely untouched, which matters because
 * that path is durable-claim / financial-write-adjacent code this task must
 * not touch.
 *
 * Correctness boundary: this wraps getReadyToSendReportCount() ONLY.
 * listReadyToSendReports() — which drives the actual Reports page panel and
 * is re-validated from scratch inside sendMonthlyReportToBoard() regardless —
 * is untouched and remains fully uncached, per its own doc comment above
 * ("Never trusts a cached 'ready' flag").
 */
const READY_TO_SEND_COUNT_CACHE_TTL_MS = 2 * 60 * 1000;

let readyToSendCountCache: { value: number; expiresAt: number } | null = null;

export async function getReadyToSendReportCountCached(): Promise<number> {
  const now = Date.now();
  if (readyToSendCountCache && readyToSendCountCache.expiresAt > now) {
    return readyToSendCountCache.value;
  }
  const value = await getReadyToSendReportCount();
  readyToSendCountCache = { value, expiresAt: now + READY_TO_SEND_COUNT_CACHE_TTL_MS };
  return value;
}

/**
 * Test-only escape hatch — clears the module-level cache so test cases don't
 * leak state into one another. Never called from application code.
 */
export function __resetReadyToSendReportCountCacheForTests(): void {
  readyToSendCountCache = null;
}

// ---------------------------------------------------------------------------
// Email composition
// ---------------------------------------------------------------------------

function renderReportEmailHtml(params: {
  entityName: string;
  fundName: string;
  statement: MonthlyStatement;
  corrected: boolean;
  previousSentAt: Date | null;
  treasurerFirstName: string;
  treasurerLastName: string;
  entitySlug: string;
  month: string;
}): string {
  const {
    entityName,
    fundName,
    statement,
    corrected,
    previousSentAt,
    treasurerFirstName,
    treasurerLastName,
    entitySlug,
    month,
  } = params;

  const link = `${getAppUrl()}/members/financial-reports/${entitySlug}/${month}`;
  const correctedLine =
    corrected && previousSentAt
      ? `<p>This replaces the statement sent on ${escapeHtml(
          previousSentAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        )}.</p>`
      : "";

  return `
    <p>The ${escapeHtml(fundName)} statement for ${escapeHtml(entityName)} is ready for ${escapeHtml(
      statement.monthEndLabel,
    )}.</p>
    <ul>
      <li>Ending Balance: ${formatCentsForEmail(statement.endingBookBalanceCents)}</li>
      <li>This Month's Net Income: ${formatCentsForEmail(statement.net.oneMonthCents)}</li>
      <li>Fiscal-Year-to-Date Net Income: ${formatCentsForEmail(statement.net.twelveMonthCents)}</li>
    </ul>
    ${correctedLine}
    <p><a href="${link}">View the full statement</a></p>
    <p>&mdash; ${escapeHtml(treasurerFirstName)} ${escapeHtml(treasurerLastName)}, Treasurer, Westerville Lions Club</p>
  `.trim();
}

// ---------------------------------------------------------------------------
// sendMonthlyReportToBoard
// ---------------------------------------------------------------------------

export type SendReportResult =
  | { ok: true; emailQueueId: string; sentAt: string; corrected: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_month"
        | "not_ready"
        | "treasurer_unresolved"
        | "already_sent"
        | "send_failed"
        // sendEmail() refused delivery under the non-production deny-by-
        // default guard (src/lib/email-guard.ts) — distinct from
        // "send_failed": nothing was actually attempted against Resend, and
        // this is the EXPECTED outcome in dev/test, not an error. See the
        // "blocked" handling below sendEmail() is called, in this file.
        | "blocked_non_production";
      detail?: string;
    };

/**
 * Re-validates everything server-side — never trusts the panel's rendered
 * state (fresh fingerprint, fresh gate check, fresh treasurer resolution).
 *
 * `sentByUserId` is a DEVIATION from the Phase 3 design doc's function
 * signature, which omitted it (`sendMonthlyReportToBoard(entityId, month)`).
 * `financial_report_sends.sent_by_user_id` is a real column recording who
 * clicked Send (distinct from `signed_as_member_id`, the resolved
 * Treasurer) — leaving it null on every row for lack of a parameter would
 * silently discard audit information the schema was built to hold. Noted
 * here rather than silently diverging; the route handler is the only
 * caller and always has `session.user.id` in scope at the call site.
 *
 * Ordering (Edge Cases, Phase 3 design):
 *   1. Validate month shape/range and the ship-date cutoff.
 *   2. Resolve entity + its single member-exposed fund — never trust a
 *      fund id from the caller, only entityId + month.
 *   3. Recompute the statement + fingerprint fresh.
 *   4. Compare against the latest SUCCESSFUL send for this (entity, month):
 *      identical fingerprint -> already_sent, BEFORE any email is sent.
 *   5. Resolve the Treasurer. Unresolvable HARD-BLOCKS (DECISION-101) —
 *      unlike the five tolerant treasury-CC call sites in board-positions.ts,
 *      the Treasurer's name is the statement's signature here, not an
 *      optional courtesy copy.
 *   6. Send via sendEmailForDurableClaim() (src/lib/email-durable-claim.ts —
 *      never sendEmail() directly, never Resend directly, never a second
 *      HTML renderer of the statement's line items). This function persists
 *      a durable success/failure claim, so DECISION-103 requires the
 *      durable-claim entrypoint: its `DurableSendResult` has no bare
 *      `success` field, so treating `not_delivered` as delivered is a
 *      compile error, not a reviewable mistake.
 *   7. Branch on the exhaustive three-way `outcome` (DECISION-102/103):
 *      `not_delivered` (the non-production deny-by-default guard refused
 *      delivery, or no RESEND_API_KEY is configured outside production —
 *      src/lib/email-guard.ts) is treated as NOT sent: write a
 *      `success: false` row (never a `success: true` claim) and return
 *      `blocked_non_production`, distinct from `send_failed`. Getting this
 *      wrong previously meant: any developer who exercised this feature once
 *      locally against `board@` (always blocked outside production,
 *      allowlist or not) wrote a permanent `success: true` claim row, and
 *      because the unique index covers `success = true` rows, that exact
 *      (entity, month, fingerprint) could never be tested as a genuine send
 *      again.
 *   8. Claim AFTER the send attempt, success or failure alike (DECISION-101)
 *      — a row is written either way, so a failure is visible on the panel
 *      and a retry after failure is never blocked (the unique index only
 *      covers `success = true` rows).
 */
export async function sendMonthlyReportToBoard(
  entityId: string,
  month: string,
  sentByUserId: string,
): Promise<SendReportResult> {
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, reason: "invalid_month" };
  }
  let bounds: ReturnType<typeof monthBounds>;
  try {
    bounds = monthBounds(month);
  } catch {
    return { ok: false, reason: "invalid_month" };
  }
  if (month < CUTOFF_MONTH) {
    // Never offered by this feature — see CUTOFF_MONTH's own doc comment.
    // Enforced here too (not just in listReadyToSendReports()) so a crafted
    // request can't bypass the panel and claim a pre-cutoff month.
    return { ok: false, reason: "not_ready" };
  }

  if (typeof entityId !== "string" || !entityId.trim()) {
    return { ok: false, reason: "not_found" };
  }
  const entity = await getEntityById(entityId);
  if (!entity) return { ok: false, reason: "not_found" };

  const funds = await getFunds(entityId);
  const exposedFunds = funds.filter((f) => isMemberExposedKind(f.kind));
  if (exposedFunds.length !== 1) return { ok: false, reason: "not_found" };
  const fund = exposedFunds[0];

  const result = await getMonthlyStatement(fund, month);
  if (!result || result.status !== "ready") {
    return { ok: false, reason: "not_ready" };
  }
  const { statement } = result;
  const fingerprint = computeTotalsFingerprint(statement);

  const lastSuccess = await getLatestSuccessfulSend(entityId, bounds.monthEnd);
  if (lastSuccess && lastSuccess.totalsFingerprint === fingerprint) {
    return { ok: false, reason: "already_sent" };
  }
  const corrected = Boolean(lastSuccess);

  const treasurer = await resolveTreasurer();
  if (!treasurer.ok) {
    return { ok: false, reason: "treasurer_unresolved", detail: treasurer.reason };
  }

  const html = renderReportEmailHtml({
    entityName: entity.name,
    fundName: fund.name,
    statement,
    corrected,
    previousSentAt: lastSuccess?.sentAt ?? null,
    treasurerFirstName: treasurer.firstName,
    treasurerLastName: treasurer.lastName,
    entitySlug: entity.slug,
    month,
  });
  const subjectBase = `${entity.shortName ?? entity.name} Financial Statement — ${monthLabelFor(month)}`;
  const subject = corrected ? `Corrected: ${subjectBase}` : subjectBase;

  const sendResult = await sendEmailForDurableClaim({
    to: BOARD_EMAIL,
    from: getFromEmail("Westerville Lions Club"),
    replyTo: treasurer.email,
    subject,
    html,
  });

  switch (sendResult.outcome) {
    case "not_delivered": {
      // The non-production deny-by-default guard refused delivery (board@
      // is a club distribution list — src/lib/email-guard.ts blocks it
      // unconditionally, allowlist or not), or no RESEND_API_KEY is
      // configured outside production. Either way, nothing was handed to
      // Resend. This function must NOT let that become a durable
      // `success: true` claim row, or the partial unique index on
      // (entity_id, month_end, totals_fingerprint) WHERE success would
      // permanently block ever testing a real send of this exact statement
      // again. Write an honest `success: false` row instead — never
      // conflicts with the partial index, so the statement stays fully
      // re-sendable — and report a distinct reason so the panel can say
      // "blocked (non-production)" rather than a generic failure.
      const blockedError =
        "Blocked — outbound email is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.";
      await db.insert(financialReportSends).values({
        entityId,
        fundId: fund.id,
        monthEnd: bounds.monthEnd,
        totalsFingerprint: fingerprint,
        sentByUserId,
        signedAsMemberId: treasurer.memberId,
        emailQueueId: sendResult.emailQueueId ?? null,
        success: false,
        error: blockedError,
      });
      return { ok: false, reason: "blocked_non_production", detail: blockedError };
    }

    case "failed": {
      // No conflict possible — the partial unique index only covers
      // success = true rows, so a failed attempt's row always inserts.
      const baseRow: NewFinancialReportSend = {
        entityId,
        fundId: fund.id,
        monthEnd: bounds.monthEnd,
        totalsFingerprint: fingerprint,
        sentByUserId,
        signedAsMemberId: treasurer.memberId,
        emailQueueId: sendResult.emailQueueId ?? null,
        success: false,
        error: sendResult.error,
      };
      await db.insert(financialReportSends).values(baseRow);
      return { ok: false, reason: "send_failed", detail: sendResult.error };
    }

    case "delivered": {
      const baseRow: NewFinancialReportSend = {
        entityId,
        fundId: fund.id,
        monthEnd: bounds.monthEnd,
        totalsFingerprint: fingerprint,
        sentByUserId,
        signedAsMemberId: treasurer.memberId,
        emailQueueId: sendResult.emailQueueId ?? null,
        success: true,
        error: null,
      };

      // Claim: INSERT ... ON CONFLICT (entity_id, month_end, totals_fingerprint)
      // WHERE success DO NOTHING RETURNING id. Two concurrent successful sends
      // for the same (entity, month, fingerprint) both reach this point (an
      // acceptable, documented cost — at most one duplicate email in the
      // double-click window, never a duplicate DB claim); only the first
      // INSERT wins the partial unique index, the second returns zero rows.
      const inserted = await db
        .insert(financialReportSends)
        .values(baseRow)
        .onConflictDoNothing({
          target: [
            financialReportSends.entityId,
            financialReportSends.monthEnd,
            financialReportSends.totalsFingerprint,
          ],
          where: sql`${financialReportSends.success} = true`,
        })
        .returning({ id: financialReportSends.id, sentAt: financialReportSends.sentAt });

      if (inserted.length === 0) {
        // Lost the race to a concurrent successful send for the identical
        // fingerprint. The email already went out (unavoidable), but the
        // claim itself is exactly what already_sent means to a caller.
        return { ok: false, reason: "already_sent" };
      }

      return {
        ok: true,
        emailQueueId: sendResult.emailQueueId,
        sentAt: inserted[0].sentAt.toISOString(),
        corrected,
      };
    }

    default: {
      const _exhaustive: never = sendResult;
      throw new Error(`Unhandled send outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
