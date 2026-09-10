# The Bulk-Email Guard Was Never Implemented, and Three Escapers Were Missing — Work Log

> **Slug:** `2026-09-10-bulk-email-guard-and-missing-escapers`
> **Surface:** `src/lib/email.ts` + ledger/reimbursement notification paths
> **Permission(s):** none — no gate changes
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped — defects established by reading the code against DECISION-085 and CLAUDE.md's own invariant | — | 2026-09-10 |
| 2 — Architectural review | architect | Skipped — no new module, no dependency; `cc` added to an existing options interface | — | 2026-09-10 |
| 3 — Technical design | tech-lead | Skipped — the fixes are what the existing decisions already specified | — | 2026-09-10 |
| 4 — Implementation | coordinator | Complete | — | 2026-09-10 |
| 5 — Verification | coordinator | Unit-verified (test fails without the fix); e2e + build below | — | 2026-09-10 |
| 6 — Shipped vs intent | — | N/A — restores documented behaviour, adds none | — | 2026-09-10 |

Found by following up the 2026-09-10 code review's MEDIUM-1, which reported two
hand-rolled `sendEmail()` loops. Pulling that thread turned up three further defects the
review did not find.

---

## Defect 1 — `sendBulkMemberEmail()`'s core guarantee did not exist

DECISION-085 states the helper "unconditionally blocks non-production delivery for *any*
bulk-individual-recipient send — no address matching, so it can't be defeated by
allowlisting". `sendEmail()` destructured `_bulkMemberSend` at line 98 and **never read
it**. The guard was only ever the ordinary per-address allowlist check.

**Consequence.** A developer puts their own address in `EMAIL_DEV_ALLOWLIST` — the
documented, intended way to receive test mail. The moment that address also appears in a
member list, a bulk send from a dev run delivered a real message. That is the exact shape
of the 2026-08-12 incident (a QA run mailing 16 real board members) that DECISION-085 was
written to prevent.

**Fix.** `(_bulkMemberSend || !isDevAllowedRecipient(to))`. Bulk sends are blocked on call
*shape*, so no dev data the guard has never heard of can defeat it, while a single
transactional send to an allowlisted address still works — which is the point of keying on
shape rather than blanket-blocking.

### The existing test could not have caught it

`email-guardrail.test.ts` already had "blocks EVERY recipient outside production", and it
passes identically with or without the fix — it never sets `EMAIL_DEV_ALLOWLIST`, so every
recipient is blocked by the allowlist clause alone. Its comment claims it "proves this
isn't an address-matching guard that a fresh dev member row could evade". It proved no
such thing.

Two tests added: one allowlists a bulk recipient and asserts they are still blocked
(**verified failing with the fix reverted**), one asserts a single send to an allowlisted
address still delivers, so the guard can't be "fixed" later by blocking everything.

## Defect 2 — three hand-rolled loops bypassed the helper entirely

`src/app/api/admin/ledger/transactions/route.ts` (×2) and
`src/app/api/members/reimbursements/route.ts` (×1) looped `sendEmail()` over
`getEmailsForFeature(FEATURES.LEDGER_APPROVE)` — every board approver. CLAUDE.md is
explicit that bulk member mail must go through `sendBulkMemberEmail()`.

The transactions route is **the same file and the same notification** as the 2026-08-12
incident. DECISION-085 created the helper in response and the call sites that caused the
incident were never moved onto it — so the fix was never applied to the code that caused
the problem.

`sendBulkMemberEmail()` gained an optional `cc` so the migration preserved the treasury CC
rule (DECISION-086) exactly; dropping to `bcc` to fit the old options shape would have
silently changed who the board can see was copied.

(The code review found 2 of these. The third, in a different file, it missed.)

## Defect 3 — member-supplied text interpolated unescaped into board email

Five sites, all reached by following defect 2:

- `api/members/reimbursements/route.ts` — `description` (member-typed) and
  `beneficiaryCause`
- `api/admin/ledger/reimbursements/[id]/route.ts` — `reimb.description` ×3 (approve,
  reject, paid) and `rejectionReason`
- `lib/members.ts` — the welcome email's `name`

CLAUDE.md records this exact failure: an escaper copy "had simply been omitted, sending
member-supplied text unescaped into an email delivered to the whole board". These were
more of the same copies. All now use the shared `escapeHtml()` from `src/lib/html-escape.ts`.

Checked and found already correct: the public contact, suggestions and membership-application
forms all escape — via their own **local** `esc()` helpers, which is the duplication the code
review counts as 4 implementations in 2 disagreeing shapes. Values the codebase itself derives
(amounts, URLs, enum labels) are deliberately left unescaped, per html-escape.ts's own note.

## Note on how defect 1 stayed hidden — partly self-inflicted

`_bulkMemberSend` appeared in the 43-warning lint backlog as *"assigned a value but never
used"* — the warning was pointing straight at it. Earlier the same day I configured
`no-unused-vars` to honour the `^_` "deliberately unused" convention, which **silenced that
warning**.

The convention is right, and the setting stays. But the two collided: here the underscore
meant `@internal — don't set this from feature code`, not *unused*. A prefix carrying one
meaning to humans and a different one to the linter will do this again. The fix happens to
resolve it — the flag is now genuinely used, so no suppression is involved — but the
general hazard is worth remembering when reading `^_` names.

## Verification

Typecheck clean; 1935 unit tests (1933 + 2 new); lint 0 errors; new bulk-guard test
confirmed failing against the pre-fix code.
