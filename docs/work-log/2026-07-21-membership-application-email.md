# Membership Application Email Notification — Work Log

> **Slug:** `2026-07-21-membership-application-email`
> **Surface:** server only (public submission route → outbound email); no UI expected
> **Permission(s):** none expected (system notification to admins)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 1 brief; Phase 2 skip candidate (existing sendEmail
> infra + direct precedent; skip must be documented); Phases 4/5/6 run in full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-07-21 |
| 2 — Architectural review | architect | Skipped (documented) | — | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | api-developer | Complete | Implemented per design | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

"We should get emails when someone submits a membership application."

**Current state (verified):** `POST /api/membership-applications` (public,
Turnstile-protected form) inserts the application row and sends nothing — no
`sendEmail` import in the route. Applications are only discoverable via the
admin dashboard's "Needs Attention" chip (whose link was broken until today —
see `2026-07-21-admin-dashboard-applications-link.md`) or the Admin →
Membership page.

**Precedent to mirror:** the unlinked-user admin alert in
`src/lib/auth/index.ts` (~line 150) — `sendEmail()` to
`info@westervillelions.org` with escaped user-provided values and a link to
the relevant admin page; fire-and-forget so the user-facing request never
fails on email trouble.

**Value:** the club currently finds out about prospective members only if the
admin happens to look. An email per submission means no application sits
unnoticed — directly serves recruitment.

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete

### Verdict: READY FOR DESIGN

### One-line take
Add a fire-and-forget admin-notification email to the existing `POST /api/membership-applications` route, mirroring the unlinked-user-alert precedent — no new schema, no new permission, one route edited.

### User verbs
- **Anonymous public visitor**: submits the `/join` application form (unchanged — no new verb). This feature adds no visitor-facing verb; the visitor's success/failure experience does not change.
- **Admin**: receives an email at `info@westervillelions.org` and can click through to `/admin/membership` to review the application. (New passive verb — "admin reads an email and clicks a link.")

### Flow
- **Entry:** visitor submits `/join` form → `POST /api/membership-applications`.
- **Step 1:** route validates `firstName`/`lastName`/`email` present, verifies Turnstile token (unchanged, already in route).
- **Step 2 (new):** on successful `db.insert`, fire-and-forget `sendEmail()` to `info@westervillelions.org` with the applicant's name, email, phone, member type, and submitted-at, plus a link to `/admin/membership`. Not awaited in a way that can affect the response — matches the JWT-callback precedent's `(async () => { try {...} catch {} })()` pattern, or an awaited call whose own try/catch swallows failure before the route's response is built. Either satisfies "never fails the applicant's request," but the route currently has no async side-channel like the JWT callback does, so the simplest correct shape is: call `sendEmail()` inside its own `try/catch` (or note `sendEmail()` already swallows Resend failures internally into `email_queue` status `failed` — see below), and do not let a thrown error from that call escape to the outer route `try/catch` in a way that changes the 200 response.
- **Success outcome (visitor):** unchanged — `{ success: true }`, form shows the existing "Thank you for applying..." confirmation copy. The visitor never sees anything about the email.
- **Success outcome (admin):** email lands in the admin's inbox with applicant summary + link.
- **Failure path (visitor):** unchanged existing paths — missing required fields → 400 with message; Turnstile failure → 400 "CAPTCHA verification failed"; DB insert failure → 500 "Failed to submit application. Please try again." None of these are touched by this feature.
- **Failure path (email):** `sendEmail()` already has its own internal failure handling — it persists to `email_queue` before attempting delivery, retries 3x against Resend, and on final failure marks the row `status: "failed"` with `nextRetryAt` for the existing admin retry mechanism. So "email failure" for this feature almost never needs bespoke handling beyond not letting a rejected promise crash the route. Confirmed: this satisfies the hard requirement that the applicant's submission never fails because of email trouble.

### Permissions
No new `FEATURES` key. This is a system-to-admin notification triggered by an unauthenticated route, not a user-facing permission gate. Existing precedent (unlinked-user alert) also uses no permission check — it emails a fixed operational address. Confirmed as correct: matches existing pattern, no gap.

### Recommendations (per the brief's specific asks)

**Recipient:** `info@westervillelions.org`, hardcoded, matching the precedent. I looked for a settings/config mechanism for notification recipients (e.g., an admin-configurable "notify" email in schema or an env var used elsewhere for this purpose) and found none — `RESEND_FROM_EMAIL` configures the *from* address only, and the unlinked-user precedent hardcodes the same `info@` address. Recommend matching precedent exactly; do not introduce a new configurable-recipient mechanism for a one-route feature — that would be scope creep past what either precedent or the user's request calls for.

**Content — gap found, recommend trimming:** the user's ask ("we should get emails when someone submits") is satisfied by a notification, not a full data dump. The `membershipApplications` schema carries fields beyond name/email/phone that are more sensitive than the precedent ever emails: `dateOfBirth`, full `address`/`city`/`state`/`zip`, `spouseName`, `occupation`, `gender`. The precedent (`unlinked-user` alert) only ever emails name + email — no address, no DOB. Recommend the email body include only: applicant's full name, email, phone, `memberType`, and submitted-at timestamp, plus the `/admin/membership` link — mirroring the precedent's minimalism. All applicant-provided string values (`firstName`, `lastName`, `email`, `phone`) must go through the same `esc()` HTML-escape helper used in the precedent before interpolation into the HTML template, since these are attacker-controlled inputs behind Turnstile but not sanitized against HTML injection at the DB layer. DOB/address/spouse/sponsor/occupation/gender should NOT travel by email — they stay behind the authenticated `/admin/membership` page, consistent with not oversharing PII over an unencrypted transport channel and consistent with the precedent's minimal-fields approach. This is a **gap the request didn't address** — flagging it now rather than let a full-field dump ship by default.

**Failure semantics:** fire-and-forget, matches both precedents (JWT callback swallow-and-catch; route's own existing 500 path is untouched). Hard requirement confirmed satisfiable: the applicant-facing response is already returned by `NextResponse.json({ success: true })` regardless of email outcome, so long as the `sendEmail()` call (or its wrapping try/catch) doesn't block/throw before that line executes, or is placed so a thrown error is caught locally rather than propagating into the route's outer `catch` block (which would incorrectly return the applicant a 500 for what is purely an admin-notification failure).

**Applicant-facing confirmation email:** out of scope. The user's request was specifically "WE should get emails" (admin notification), not an applicant receipt. Recommend scoping this out explicitly rather than silently; if wanted later, it's a separate, smaller follow-up (same route, second `sendEmail()` call to the applicant's own address, needs its own copy/branding review).

**Anti-abuse:** Turnstile already guards the public form (verified in the route — `captchaToken` required, verified server-side against Cloudflare before the DB insert). Email volume is bounded by the same gate that bounds application volume; no new rate-limit is needed at club scale. Confirmed, not a gap.

### Gaps the request didn't address
- **Field selection for the email body** (addressed above — recommend minimal fields, not a full record dump). Matters because address/DOB/spouse-name in a plaintext email is unnecessary PII exposure beyond what the precedent or the user's ask requires.
- **HTML-escaping of applicant-controlled strings** — the route currently does zero sanitization of `firstName`/`lastName`/`phone`/`email` before DB insert (they're stored raw, which is fine for a parameterized DB write, but not fine for raw interpolation into an HTML email body). Must reuse the precedent's `esc()` helper. Flagging explicitly since this is the kind of thing an accelerated brief could skip.
- **Mobile / brand consistency:** not applicable — this feature has no UI surface (server-only, per work-log header). Confirmed n/a, not a silent gap.
- **Access-pending / OAuth-vs-password / Google Group sync:** not applicable — no signed-in-user surface is touched by this feature. Confirmed n/a.

### Out of scope (confirm with user)
- Applicant-facing "we received your application" confirmation email — recommend deferring (see above).
- Configurable notification recipient (e.g., admin UI to change the target address) — recommend deferring; hardcode per precedent.

### Open questions
None — the brief's asks are all resolved above by precedent-matching or the schema read; nothing surprising surfaced in the route that needs the user's input before Phase 2/3.

### Phase 2 (architect) recommendation
**Skip, with this documentation standing in for the architectural review.** Rationale: no new directory, no new npm dependency, no new schema/table, no new permission — this is a single existing route (`src/app/api/membership-applications/route.ts`) gaining one `sendEmail()` call that reuses `src/lib/email.ts` infra already wired to Resend/`email_queue`, following a pattern (`src/lib/auth/index.ts` ~line 150) already established in this codebase. There is no structural decision left for the architect to make. Tech-lead should write a brief paragraph design in Phase 3 covering: exact placement of the `sendEmail()` call relative to the `db.insert` (after, so it only fires on successful insert), the exact HTML template with `esc()`-wrapped fields, and confirmation that the call is wrapped so a rejected promise can't escape into the route's outer `catch` (which currently returns a 500 to the applicant).

### Implementer recommendation
**api-developer.** This is a pure server-side change to one route handler — no client component, no form change, no page. It doesn't meet the bar for full-stack-developer (which is for work spanning server + client); there's no client half here at all.

---

# Phase 2 — Architectural Review (architect)

**Owner:** architect
**Status:** Skipped (documented) — per Phase 1's explicit recommendation

### Rationale for skip
Confirmed against source: this feature adds one `sendEmail()` call to the existing
`src/app/api/membership-applications/route.ts` handler, reusing `src/lib/email.ts`
infra that is already wired to Resend + `email_queue`. There is:
- **No new directory or module.**
- **No new npm dependency** — `next/server`'s `after()` (used in Phase 3 below) ships
  with the already-installed Next.js 16.2.9; confirmed exported (`exports.after` in
  `node_modules/next/server.js`).
- **No schema change** — `membershipApplications` and `emailQueue` are unmodified.
- **No new permission** — this is a system-to-admin notification off an
  unauthenticated route, matching the existing unlinked-user-alert precedent
  (`src/lib/auth/index.ts` ~line 192), which also carries no permission check.

No structural decision is left for the architect to make. This documentation stands
in for the Phase 2 gate, per the pipeline's Bug-Fix/accelerated-mode provision that
skipping a phase requires explicit notation — noted here.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** Complete

### Summary
One route (`src/app/api/membership-applications/route.ts`) gains a fire-and-forget
admin-notification email, fired after the application row is successfully inserted.
The design mirrors the existing unlinked-user-alert precedent in
`src/lib/auth/index.ts` (~line 192) for recipient, from-address, escaping, and
try/catch swallow shape — with one deliberate deviation from a literal copy of that
precedent: scheduling via Next.js's `after()` API instead of a bare unawaited IIFE.
No schema or permission changes. No decisions.md entry — this is a small
implementation-pattern call, stated inline below.

### 1. Call placement — decision: `after()`, not a bare void-IIFE, not awaited-inline

Phase 1 flagged two options (await-with-local-catch, or a void-IIFE matching the
JWT-callback precedent) and left the exact shape to Phase 3. I'm recommending a
third option, with concrete cause:

**Why not await-with-local-catch:** `sendEmail()` inserts into `email_queue` first
(fast), then — only when `RESEND_API_KEY` is set — attempts delivery up to 3x with a
500ms sleep between failed attempts (`src/lib/email.ts` `MAX_ATTEMPTS` /
`RETRY_DELAY_MS`). Awaiting this inline could add up to ~1s of latency to the
applicant's response on a bad Resend day, for a side-effect the applicant never
sees. That's the same reason the JWT-callback precedent doesn't await its IIFE
either ("Fire-and-forget so we don't block the JWT response" — `auth/index.ts` line
143).

**Why not a bare void-IIFE (the literal precedent shape):** the precedent's IIFE
runs inside a NextAuth callback, not a Route Handler returning an HTTP response. In
*this* route, the very next statement after the email dispatch is
`return NextResponse.json({ success: true })`. On Vercel serverless, once a Route
Handler's response is returned, the function instance may be frozen/torn down
before an unawaited background promise finishes — there's no guarantee the
`email_queue` insert or the Resend call inside a bare `(async () => {...})()`
completes. That would silently drop notifications under load, which defeats the
entire point of this feature.

Next.js ships `after()` from `next/server` for exactly this: schedule work to run
after the response is sent, with the runtime guaranteeing it completes before the
function fully terminates — no new dependency (confirmed exported from the
already-installed Next 16.2.9), no added latency to the applicant, and no
drop-on-freeze risk. This is a case where "prefer consistency with precedent"
loses to a concrete correctness gap the precedent itself doesn't have to worry
about (NextAuth's own callback lifecycle differs from a Route Handler's). Precedent
is still followed for everything *inside* the callback — recipient, from-address,
escaping, and the local try/catch swallow.

Exact placement — after `db.insert`, before the response:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";

// ...existing validation + captcha check unchanged...

await db.insert(membershipApplications).values({ /* unchanged */ });

after(async () => {
  try {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
    await sendEmail({
      from: `Westerville Lions Portal <${fromEmail}>`,
      to: "info@westervillelions.org",
      subject: "New membership application received",
      html: `
        <h2>New Membership Application</h2>
        <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)}</p>
        <p><strong>Email:</strong> ${esc(email)}</p>
        <p><strong>Phone:</strong> ${esc(phone || "(not provided)")}</p>
        <p><strong>Member Type:</strong> ${esc(memberType || "new")}</p>
        <p><strong>Submitted:</strong> ${esc(new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }))}</p>
        <p>Review this application in <a href="https://westervillelions.org/admin/membership">Admin &rarr; Membership</a>.</p>
      `,
    });
  } catch {
    // Swallow — background email task must not throw, and must never affect
    // a response that has already been sent to the applicant.
  }
});

return NextResponse.json({ success: true });
```

The `try/catch` inside `after()` is belt-and-suspenders: `sendEmail()` already
catches its own Resend-call failures internally (see below), so the only realistic
throw site is the initial `emailQueue` insert failing (e.g., a DB blip). Either way,
nothing here can reach the route's outer `catch` — that block is above this code
and only wraps the validation/captcha/insert path, which is unaffected because
`after()`'s callback doesn't execute until after the response is already built.

### 2. Email template

**Subject — fully static, no interpolation:** `"New membership application
received"`. Matching the precedent exactly (its subject,
`"New portal user needs member record review"`, also has zero interpolated
values) — keeps applicant-controlled strings entirely out of the email header,
sidestepping any header-injection question rather than relying on Resend's JSON
transport to make it moot.

**Body fields — exactly the five approved in Phase 1, nothing else:**
`firstName` + `lastName` (joined), `email`, `phone`, `memberType`, submitted-at.
No `dob`/`address`/`spouse`/`occupation`/`gender` — confirmed absent from the
template above.

**`esc()` — duplicate locally, don't hoist.** One-line justification: the
codebase's existing precedent for this exact 4-line helper is inline duplication
at its one call site (`auth/index.ts`); hoisting now would require also refactoring
that call site to avoid ending up with three copies of escaping logic (old inline
+ new shared + orphaned old inline), and that file is out of scope for this
read-only-on-source ticket. If a third call site appears, that's the point to hoist
into a shared `esc()`/`escapeHtml()` util — not before.

**Admin link — absolute URL, hardcoded origin, matching precedent exactly.** The
precedent links `https://westervillelions.org/admin/users` (hardcoded prod origin,
not built from `NEXTAUTH_URL` or any env var). This design uses
`https://westervillelions.org/admin/membership` the same way — consistent with
existing practice, not introducing a new URL-construction pattern for one feature.

**Submitted-at timestamp:** `new Date()` at request-handling time, formatted via
`toLocaleString("en-US", { timeZone: "America/New_York", ... })` — matching the
`America/New_York` timezone convention already used in `src/lib/ledger.ts`
(`monthName` formatting) and `src/lib/events.ts` (VTIMEZONE block). Not read back
from the DB's `createdAt defaultNow()` column — no `.returning()` added to the
insert — because the two values differ by at most milliseconds and adding a
`.returning()` clause is unjustified complexity for a cosmetic timestamp in an
internal notification email.

### 3. Recipient / from-address
- **To:** `"info@westervillelions.org"`, hardcoded — matches precedent, matches
  Phase 1's recommendation. No settings/config mechanism exists for a configurable
  notification recipient, and none should be introduced for this ticket.
- **From:** `` `Westerville Lions Portal <${fromEmail}>` `` where
  `fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"` —
  byte-for-byte the precedent's from-shape.

### 4. Named unit tests — decision: none; Phase 5 covers this via manual/integration verification

Checked: no test file exists for this route (no
`membership-applications*.test.ts` anywhere in the repo), and — more importantly —
**no API route handler in this codebase has a unit test.** Every existing
`*.test.ts` file (`src/lib/dues.test.ts`, `src/lib/ledger.test.ts`,
`src/lib/permissions.test.ts`, etc.) targets pure helper logic in `src/lib/`, not
Route Handlers. The precedent this feature mirrors (`auth/index.ts`'s unlinked-user
alert) is itself untested at the same level of granularity — its `esc()` and email
template have no unit test today.

Given that, extracting the template-building logic into a new `src/lib/` module
purely to satisfy "named unit tests" would add a file + a test file for what is,
in total, ~15 lines of string interpolation — more ceremony than the feature's own
size or the codebase's established testing boundary calls for, and it cuts against
"prefer the minimum complexity that solves today's problem."

**Phase 5 (qa) covers this via integration**, not unit tests:
1. Submit the `/join` form (or `POST` the route directly) with a full payload.
2. Confirm the applicant still gets `{ success: true }` / the existing thank-you
   copy — unaffected by anything in this feature.
3. Confirm a new `email_queue` row appears with `to = 'info@westervillelions.org'`,
   the correct static subject, and a `body`/`html` containing the escaped applicant
   fields (name/email/phone/memberType/timestamp) and the `/admin/membership` link
   — and that DOB/address/spouse/occupation/gender are **not** present in the row.
4. Confirm a bad email path (e.g., simulate an `emailQueue` insert failure, or just
   reason from the code that the `try/catch` inside `after()` prevents it) still
   leaves the applicant's response unaffected.

This is an explicit, intentional gap-fill relative to the pipeline's default
("every unit test named in the Phase 3 design doc is written and passing") — there
are no named unit tests for this ticket, only the integration checks above, because
none apply to code the codebase's own convention doesn't unit test.

### 5. Implementer
**api-developer — confirmed.** Pure server-side change to one Route Handler; no
client component, no form change, no page. Doesn't meet the bar for
full-stack-developer (no client half exists here).

### 6. Edge cases
- **Phone absent:** `phone` is nullable in `membershipApplications` and already
  optional in the route's destructuring (`phone || null` at insert time). Template
  guards with `phone || "(not provided)"` before `esc()`.
- **`memberType` values:** the DB insert already defaults to `"new"`
  (`memberType || "new"`) when absent; the notification echoes that same computed
  value (not the raw, possibly-empty request field) so the email always reflects
  what was actually stored, whatever string was sent (`new | former | transfer |
  family | student | leo | young_adult` per the schema comment, but the column
  accepts any string — the email doesn't validate/whitelist it, matching the
  route's existing behavior of not validating this field).
- **Long names:** no truncation. This is an internal HTML email to a single admin
  inbox, not a public rendered surface with fixed-width layout constraints — normal
  email-client text wrapping handles arbitrary length. `esc()` still runs on the
  full untruncated string.
- **Email absent:** not reachable — `email` is required by the route's existing
  400-path validation (`if (!firstName || !lastName || !email)`), so it is always
  present by the time the notification fires.
- **Local/dev email behavior (qa must know this):** `RESEND_API_KEY` is not set
  locally. Per `src/lib/email.ts`, `sendEmail()` always inserts the `email_queue`
  row first, then — with no API key — takes the "Dev mode" branch: logs
  `` `[Email] To: ${to} | Subject: ${subject}` `` to the console, updates the row to
  `status: "sent"`, `sentAt: new Date()`, `attempts: 1`, and returns
  `{ success: true }`. **No real network call to Resend happens, and no email
  actually lands in an inbox locally.** "Success" in dev/QA means: the console log
  line appears, and the `email_queue` row is `status = 'sent'` with the expected
  `to`/`subject`/`html` — not an actual delivered email. QA should check the
  `email_queue` table (or the admin email-queue inspection page) rather than
  waiting on an inbox.

### Edge Cases & Risks (design-doc format, for completeness)
- Risk: `after()` misuse (e.g., accidentally awaited before `return`) would
  reintroduce the latency Phase 1 flagged — implementer should not `await` the
  `after(...)` call itself, only the `sendEmail()` inside its callback.
- Risk: none identified around double-sends — the route has no retry/resubmit
  path that would call `sendEmail()` twice for one application.

### Out of Scope (confirmed from Phase 1, unchanged)
- Applicant-facing confirmation email.
- Configurable notification recipient.

---

# Phase 4 — Implementation (API) — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary
Added a fire-and-forget admin-notification email to
`src/app/api/membership-applications/route.ts`, implemented byte-for-byte per
the Phase 3 design: `after()` scheduling, static subject, a locally-duplicated
`esc()` helper, the five approved fields only, and a hardcoded recipient/admin
link. No schema, no permission, no other file touched. All three build gates
pass; a scratch-script sanity check (script deleted after use) confirms the
`email_queue` row content and proves cleanup.

### What I did
- Added `import { after } from "next/server";` and `import { sendEmail } from
  "@/lib/email";` to the route.
- Inserted an `after(async () => { try { ... } catch {} })` block immediately
  after the successful `db.insert(membershipApplications)` and before
  `return NextResponse.json({ success: true })`, exactly matching the Phase 3
  code block (no deviation).
- Confirmed the outer route `try/catch` cannot be reached by anything inside
  the `after()` callback — the callback's own `try/catch` swallows all errors,
  and `after()`'s registration call itself only throws when there is no
  request scope (a condition that cannot occur once this ships behind a real
  Next.js request).
- Ran the three Phase 4 gates (see below).
- Corrected one factual assumption in the Phase 3 design during sanity-check
  prep: **`.env.local` on this machine actually has a real `RESEND_API_KEY`
  set** (contrary to the design doc's "not set locally" assumption). To avoid
  sending a real email to the club's real `info@westervillelions.org` inbox
  during verification, I forced the dev-mode branch by deleting
  `RESEND_API_KEY` from `process.env` inside the transient sanity-check
  script's own process only — `.env.local` itself was never modified. Flagging
  this for qa (see handoff notes) since qa's own local run will hit the same
  real key unless it does the same thing or is otherwise aware.
- Also discovered (and worked around) that the actual `POST` handler cannot be
  invoked directly from a plain Node/tsx script: Next's `after()` throws
  `` `after` was called outside a request scope `` when there is no live
  Next.js request context (confirmed by reading
  `node_modules/next/dist/server/after/after.js`), and starting a dev server
  was explicitly out of scope for this task. Since that throw happens
  synchronously inside the route's own outer `try/catch`, driving the route
  directly here would have manufactured a false 500 despite a successful DB
  insert — not a real bug, just an artifact of testing a request-scoped API
  outside a request. Worked around it by mirroring the exact `after()`-callback
  code (insert + template + `sendEmail()` call) in the scratch script instead,
  which exercises the identical content-generation and `email_queue`-persist
  path without needing Next's request-scope machinery.

### Outputs

**Files touched:**
- `/Users/cshenso/git/westervillelions/src/app/api/membership-applications/route.ts` — the only source file changed.
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-07-21-membership-application-email.md` — this entry.

**No schema changes. No migration. No new `FEATURES` key.**

**Endpoint (unchanged contract, new side effect only):**
- `POST /api/membership-applications` — public, Turnstile-protected, no auth/feature gate (unchanged).
  - Request body: unchanged (`firstName`, `lastName`, `email`, `captchaToken`, plus the existing optional applicant fields).
  - Response: unchanged — `{ success: true }` on success; existing 400/500 error shapes untouched.
  - **New side effect:** on successful insert, schedules (via `after()`) a fire-and-forget email to `info@westervillelions.org`:
    - From: `` `Westerville Lions Portal <${process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"}>` ``
    - Subject (static): `"New membership application received"`
    - Body fields (each through a local `esc()` helper): `firstName` + `lastName`, `email`, `phone` (or `"(not provided)"` if absent), `memberType` (the computed/defaulted value, not the raw request field), submitted-at formatted via `toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })`, and a static absolute link to `https://westervillelions.org/admin/membership`.
    - No `dob`/`address`/`spouse`/`occupation`/`gender`/`sponsor` fields — confirmed absent from the template.
    - Any failure in this path (including a `sendEmail()` rejection) is swallowed inside the `after()` callback's own `try/catch` and can never change the applicant's response.

### Gate results
- `pnpm exec tsc --noEmit` — clean, no output.
- `pnpm test` — **432/432 passed** (13 test files), matching the design doc's stated baseline; no new tests added, per Phase 3's explicit, justified decision that no unit tests apply to this route (no route handler in the codebase has unit tests; extracting a module solely to test ~15 lines of string interpolation was rejected as unjustified ceremony). This is a documented exception to the default "every named unit test ships," not a silent gap — Phase 3 named zero unit tests for this ticket.
- `pnpm build:only` — production build succeeded; `/api/membership-applications` listed as a dynamic (`ƒ`) route in the build output; no errors or warnings related to this change.

### Sanity-check proof (no unit tests per design — integration-style manual check instead)
Ran a transient script (`scripts/_tmp-membership-email-sanity-check.ts`, created,
executed, then deleted — not committed) against the local Neon DB from
`.env.local`, via `pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/_tmp-membership-email-sanity-check.ts`:

1. Inserted a synthetic `membership_applications` row with a full payload,
   deliberately including `dateOfBirth`, `address`, `spouseName`,
   `occupation`, `gender`, and `sponsorName` (to prove the email omits them
   even though they exist on the row), plus an HTML/entity-bearing name
   (`Test<script>` / `Applicant&Co`) to exercise `esc()`.
2. Called `sendEmail()` with the exact template from the route's `after()`
   callback (RESEND_API_KEY deleted from `process.env` for this script's
   process only, forcing the documented dev-mode branch — no real network
   call, no real email sent to `info@westervillelions.org`).
3. Read back the resulting `email_queue` row and verified:
   - `to`: `info@westervillelions.org` (exact match)
   - `subject`: `"New membership application received"` (exact match, static)
   - `status`: `sent`, `attempts`: `1` (dev-mode branch, as expected locally)
   - `html` contains the escaped name (`Test&lt;script&gt; Applicant&amp;Co`),
     phone, member type, formatted `America/New_York` timestamp, and the
     `https://westervillelions.org/admin/membership` link.
   - `html` does **not** contain any of: `1990-01-01`, `123 Secret St`,
     `Spouse Testerson`, `Engineer`, `female`, `Sponsor Name` — confirmed via
     grep-equivalent substring search, zero matches.
   - Raw `<script>` tag absent (escaped to `&lt;script&gt;`) — confirms XSS
     protection via `esc()`.
4. Deleted the test `email_queue` row and the test `membership_applications`
   row, then re-queried both by id and confirmed 0 rows remaining for each —
   cleanup proven, not just asserted.
5. Deleted the scratch script itself (`scripts/_tmp-membership-email-sanity-check.ts`); `git status` after cleanup shows no diff outside the two files listed under Outputs.

Full console output of the sanity run (for the record):
```
RESEND_API_KEY present after delete? false
Inserted synthetic application: a1ad8afd-0dfe-4253-b71e-a07fd1754d2e
[Email] To: info@westervillelions.org | Subject: New membership application received
sendEmail() result: { success: true }
--- email_queue row ---
to: info@westervillelions.org
from: Westerville Lions Portal <onboarding@resend.dev>
subject: New membership application received
status: sent
attempts: 1
Forbidden strings found in html: NONE (pass)
Escaped name fields present: true
Raw <script> tag absent (XSS-safe): true
Admin link present: true
Subject exact match: true
Recipient exact match: true
--- Cleanup verification ---
email_queue rows remaining with test id: 0
membership_applications rows remaining with test id: 0
Cleanup verified: both test rows deleted.
```

### Deviations from Phase 3 design
None in the shipped code — the `after()` block, template, field list, escaping,
recipient, from-address, and subject are byte-for-byte what Phase 3 specified.

The one deviation is in **how verification was performed**, not in the code:
Phase 3's edge-cases section assumed `RESEND_API_KEY` would be absent locally
so the route's own dev-mode branch would fire naturally; in fact a real key is
present in this machine's `.env.local`. I did not change `.env.local` — I
forced the dev-mode branch only inside the disposable sanity-check script's
own process, and never exercised the real Resend network path. This is worth
qa's attention (see below) since a real key being present locally is a latent
risk for any future *manual* end-to-end click-through (e.g., via `pnpm dev`)
that submits the real `/join` form without accounting for it.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).**
- **Real `RESEND_API_KEY` locally:** qa should know that `.env.local`'s
  `RESEND_API_KEY` is a real (or at least real-shaped) Resend key, not absent
  as Phase 3 assumed. If qa's click-through plan involves submitting the real
  `/join` form against a local dev server, that will trigger a **real** Resend
  send attempt to `info@westervillelions.org` (the club's real inbox) unless
  qa either (a) temporarily unsets `RESEND_API_KEY` for that terminal session,
  or (b) is fine with a real test email landing in the club's real inbox and
  cleans it up / flags it to the club. Recommend (a).
- **`after()` cannot be driven by a plain script** — confirmed via
  `node_modules/next/dist/server/after/after.js`. Any qa verification of the
  actual route (not just the email template) needs a real Next.js request
  context — i.e., a running dev server (`pnpm dev`) or the production build
  (`pnpm build:only` + `pnpm start`), then a real `fetch`/form POST to
  `/api/membership-applications`. A plain script import of the route module
  will throw at the `after()` call and produce a misleading 500, even though
  the DB insert already succeeded — not a product bug, just a testing
  artifact to be aware of.
- **No unit tests were added**, per Phase 3's explicit, justified decision
  (see Gate results above) — this is not an oversight to catch in Phase 5; qa
  should not expect to find a `membership-applications.test.ts` file.
- Suggest qa's click-through: submit `/join` with a real (self-provided) test
  email, confirm applicant-facing success is unchanged, then check the
  `email_queue` table (or admin email-queue inspection page) for the new row
  rather than waiting on a real inbox — matching Phase 3's edge-case guidance.

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete

### Verdict: PASS

### Summary
All four gates pass, and a live end-to-end run against a real Next.js dev
server (with `RESEND_API_KEY` neutralized) confirms the feature does exactly
what Phases 1-3 specified: the applicant's response is byte-identical to the
pre-feature shape, the `after()` callback fires post-response, the
`email_queue` row contains only the five approved fields (name, email, phone,
memberType, submitted-at) plus the admin link, all applicant-controlled
strings are HTML-escaped (verified with a `<script>` payload), and none of
`dob`/`address`/`spouse`/`occupation`/`gender`/`sponsorName` leaked into the
email body despite being present on the underlying DB row. No real email left
the building at any point. All synthetic rows were deleted and cleanup was
proven by re-querying, not just asserted. No protected routes are touched by
this feature (public, unauthenticated route by design).

### What I did
- Read the route (`src/app/api/membership-applications/route.ts`) and
  `src/lib/email.ts` in full to confirm the shipped code matches the Phase 3
  design byte-for-byte before running anything.
- Ran the three automated gates from a clean checkout state.
- Started `pnpm dev` on port 3000 with `RESEND_API_KEY=""` in the parent
  shell (dotenv-cli does not override an already-set var, confirmed via
  `dotenv --help` — no `--override`/`-o` flag is used in the `dev` script).
  Verified via `ps eww <pid>` on the actual running node processes that
  `RESEND_API_KEY=` was empty inside the server, not the real key from
  `.env.local`.
- **Turnstile gotcha found and worked around, not coded around:** the route's
  fallback is `process.env.TURNSTILE_SECRET_KEY ?? "1x0000...AA"` — nullish
  coalescing, which does **not** trigger on an empty string. Setting
  `TURNSTILE_SECRET_KEY=""` (mirroring the `RESEND_API_KEY` trick) left an
  empty secret being sent to Cloudflare's real siteverify endpoint, which
  correctly returned `success:false` (confirmed by curling
  `https://challenges.cloudflare.com/turnstile/v0/siteverify` directly with
  an empty secret). Fix: restarted the dev server with
  `TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"` — Cloudflare's
  own documented "always passes" test secret, the same value the route's own
  code already falls back to. This is not a code change and does not weaken
  anything — it exercises the exact fallback path already written into the
  route, using Cloudflare's own designated testing credential. Verified
  directly against Cloudflare's siteverify endpoint that this secret accepts
  any response token before relying on it through the app.
- Submitted a synthetic application (`firstName: "QA-Test"`, deliberately
  including `dateOfBirth`/`address`/`spouseName`/`occupation`/`gender`/
  `sponsorName` on the request so the email template's omission of them could
  be proven against a real row, not just reasoned about) via `curl` directly
  against the running route.
- Submitted a second synthetic application with
  `firstName: "QA-Test<script>alert(1)</script>"` to prove HTML-escaping.
  Also verified the pre-existing missing-fields and missing-captcha 400
  paths are unaffected by curling both directly.
- Inspected `email_queue` and `membership_applications` via transient
  read-only + cleanup scripts under `scripts/_tmp-qa-*.ts` (all six deleted
  after use; `git status` confirms no stray script files remain).
- Deleted both synthetic `membership_applications` rows and both synthetic
  `email_queue` rows, then re-queried to confirm 0 remain (not just asserted
  the delete "succeeded").
- Killed the dev server and confirmed port 3000 is free (`lsof` returns
  nothing, `pgrep` finds no `next dev`/`next-server` processes).

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — clean, no output.

#### Unit Tests
`pnpm test`: **PASS**
Total: 432 | Passed: 432 | Failed: 0
Duration: 283ms (13 test files)
Failures: none.
No new unit tests were added, per Phase 3's explicit, justified decision
(no Route Handler in this codebase has a unit test today; extracting a
module solely to test ~15 lines of string interpolation was rejected as
unjustified ceremony). Confirmed as a documented exception, not a silent gap
— Phase 3 named zero unit tests for this ticket, and none are missing
relative to that plan.

#### Production Build
`pnpm build:only`: **PASS**
Notes: build succeeded; `/api/membership-applications` listed as a dynamic
(`ƒ`) route in the build output, consistent with an unchanged route contract.
No errors or warnings related to this change.

#### End-to-End Tests
`pnpm test:e2e`: **Not run** — no Playwright spec exists for this route (no
UI surface; the design doc explicitly scoped this as integration-verified by
qa rather than unit- or e2e-tested, since there's no client component or page
to drive with Playwright — the visitor-facing `/join` form itself is
unchanged). This is the documented exception carried forward from Phase 3,
not a skipped gate.

#### Live Verification (dev server, Resend key neutralized)
1. **Gate check before submission:** confirmed via `ps eww <pid>` on the
   actual running dev-server node processes that `RESEND_API_KEY=` was empty
   (not the real `.env.local` value) before any submission was made.
2. **Synthetic submission #1** (`firstName: "QA-Test"`, full payload including
   PII fields): `POST /api/membership-applications` → `{"success":true}`,
   HTTP 200. Console log shows
   `POST /api/membership-applications 200 in 729ms` **followed by**
   `[Email] To: info@westervillelions.org | Subject: New membership
   application received` — proving the `after()` callback fired after the
   response was already sent, and that dev-mode fired (no real Resend network
   call was made; `sendEmail()`'s dev-mode branch only logs and marks the row
   `sent` locally).
3. **`email_queue` row content** (queried directly, not inferred): `to =
   info@westervillelions.org` (exact), `subject = "New membership application
   received"` (exact, static), `status = sent`, `attempts = 1`. `html`
   contains the escaped name (`QA-Test Synthetic`), email
   (`qa-test-synthetic@example.invalid`), phone (`555-000-1111`), member type
   (`Member Type:</strong> new`), a formatted `America/New_York` timestamp,
   and the `https://westervillelions.org/admin/membership` link. Substring
   search confirmed **zero** matches for any of: `1990-01-01`,
   `123 Secret St`, `Spouse Testerson`, `Engineer`, `female`, `Sponsor Name`
   — the six PII fields present on the underlying `membership_applications`
   row but correctly absent from the email.
4. **XSS check:** submitted `firstName: "QA-Test<script>alert(1)</script>"`.
   Resulting `email_queue.html` contains
   `QA-Test&lt;script&gt;alert(1)&lt;/script&gt; XSS-Check` — escaped. A raw
   `<script>` substring is absent (confirmed `false`). The `esc()` helper is
   doing its job.
5. **Failure isolation (code-read + reasoning, since manufacturing a real
   `sendEmail()` rejection in a running dev server isn't practical without
   destabilizing the DB connection the route itself depends on):** the
   `after()` callback wraps its entire body — the `esc()` calls, template
   build, and `await sendEmail(...)` — in a single local `try { } catch { }`
   that does nothing but swallow. `after()`'s own registration call
   (`after(async () => {...})`) happens synchronously, before
   `return NextResponse.json({ success: true })`, and only throws when there
   is no request scope (per Phase 4's finding reading
   `node_modules/next/dist/server/after/after.js`) — a condition that cannot
   occur inside a real request, as demonstrated by every successful live
   submission above. Since the callback body itself is registered but not
   *executed* until after the response is already built and returned, no
   exception thrown inside it — whether from `sendEmail()`'s internal Resend
   retry logic or from the `emailQueue` insert — can reach the route's outer
   `try/catch`, which only wraps the validation/captcha/insert path above the
   `after()` call. This reasoning is confirmed structurally by reading the
   route (lines 18-116): the outer `catch` at line 109 is syntactically
   outside and after the `after()` registration, and `after()`'s callback
   executes on a separate tick post-response — there is no code path by
   which a callback-internal throw can influence the response already
   returned at line 108.
6. **Pre-existing failure paths unaffected:** `POST` with no `firstName`/
   `lastName`/`email` → `{"error":"First name, last name, and email are
   required"}`, HTTP 400 (unchanged). `POST` with no `captchaToken` →
   `{"error":"CAPTCHA verification required"}`, HTTP 400 (unchanged). Row
   counts confirmed neither of these created a `membership_applications` row
   (count stayed at 2 — only the two valid synthetic submissions — proving
   the insert genuinely gates on validation, unaffected by the email
   feature).
7. **Applicant response byte-comparison:** live response body for a
   submission with the email path fully active was `{"success":true}`,
   HTTP 200 — byte-identical to the pre-feature shape stated in the design
   doc and in Phase 4's Outputs section. No new field, no changed status
   code, no added latency source in the synchronous response path (the
   `after()` call is fire-and-forget by construction, not awaited before the
   `return`).

#### Manual Click-Through
Not needed beyond the live dev-server verification above — this feature has
no OAuth/Givebutter/live-Google-Workspace dependency, and the "live" run
above already drove the real route end-to-end (not a script bypassing
`after()`'s request-scope requirement, unlike Phase 4's sanity check, which
could not invoke the real route at all). No flow in this feature requires a
human click-through the runner couldn't reach.

| Flow | Result | Notes |
|------|--------|-------|
| Real `/join` browser form submission | Not driven (route driven directly instead) | Equivalent coverage: the route contract is identical regardless of whether the POST originates from the `/join` page's fetch call or curl; the `/join` form itself is unchanged by this feature (confirmed no diff to any file under `src/app/join/`). |

### Regression Tests Added
None. Per Phase 3's explicit, justified decision (no Route Handler in this
codebase has unit-test coverage; the codebase's established testing boundary
is `src/lib/**`, not `src/app/api/**`), there is no regression test suite gap
to fill here — this is a net-new feature, not a bug fix, and Phase 3 already
documented why unit tests don't apply. The live verification above is the
substitute, and it is reproducible by any future qa run following the same
steps (neutralize both env vars, submit, inspect `email_queue`, clean up).

### Coverage on Critical Modules
Not applicable — this feature touches zero files in `src/lib/events.ts`,
`src/lib/permissions.ts`, or `src/lib/members.ts`. No coverage drift on those
modules from this change.

### Feature-Gate Audit (mandatory before PASS)
**No protected routes touched.** `POST /api/membership-applications` is, by
design (Phase 1/2/3, all confirmed), a public, unauthenticated,
Turnstile-protected route — it carries no `auth()` call and no
`hasFeature()` check both before and after this change, which is correct:
it's a visitor-facing public form submission endpoint, not an admin surface,
and the notification email it now sends targets a fixed operational address
rather than gating any data behind a permission. Confirmed by reading the
full route file (lines 1-116) — no new route, server action, or admin
surface was added or modified by this feature.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/membership-applications` | No (by design — public form) | No (by design — public form) | N/A — no `FEATURES.*` key applies to an unauthenticated public submission route |

### Cleanup Proof
- Baseline before any submission: `membership_applications` = 0 rows,
  `email_queue` = 591 rows.
- After 2 valid synthetic submissions: `membership_applications` = 2 rows,
  `email_queue` = 593 rows (2 new rows, matching the 2 valid submissions;
  the 2 failed/400 submissions correctly created no rows).
- After cleanup: re-queried both tables by the synthetic identifiers
  (`email LIKE 'qa-test%example.invalid'` for applications; `subject = 'New
  membership application received'` for the queue) — **0 rows remaining in
  both**, proven by query, not asserted from memory.
- All six transient `scripts/_tmp-qa-*.ts` helper scripts deleted after use.
  `git status --porcelain` shows no stray files under `scripts/` — the only
  diff touching this feature's surface is the pre-existing Phase 4 change to
  `src/app/api/membership-applications/route.ts` and this work-log entry.
- Dev server killed; `lsof -i :3000` returns nothing; `pgrep -fl "next
  dev|next-server"` returns nothing — port 3000 is free.
- **No real email left the building at any point:** every `[Email] To:
  info@westervillelions.org | ...` console line was preceded by confirmation
  that the server process's `RESEND_API_KEY` was the empty string, not the
  real key from `.env.local`; `sendEmail()`'s own code (`src/lib/email.ts`
  line 42: `if (!process.env.RESEND_API_KEY)`) only takes the dev-mode
  logging branch and never constructs a `Resend` client or calls
  `resend.emails.send(...)` when the key is falsy — confirmed by reading the
  function, not just by absence of an error.

### Open questions / handoff notes
- **Next agent: analyst (Phase 6).** This is a clean PASS with no loop-back.
- **Gotcha worth carrying forward to the next feature that reuses
  `verifyTurnstile`'s pattern:** the `?? fallback` idiom in
  `verifyTurnstile` (route.ts line 8) does not activate on an empty-string
  env var, only on `undefined`/`null`. Any future qa run that tries the
  "set to empty string" neutralization trick on `TURNSTILE_SECRET_KEY`
  specifically will hit the same false-negative CAPTCHA failure this run
  hit — use Cloudflare's documented test secret value instead
  (`1x0000000000000000000000000000000AA`), not an empty string, when
  neutralizing Turnstile locally.
- **`.env.local`'s real `RESEND_API_KEY` remains untouched** — only the
  parent shell's exported env var was neutralized for the two dev-server
  processes started in this session, both of which are now killed. Any
  future `pnpm dev` run without the explicit `RESEND_API_KEY=""` prefix will
  load the real key again, per Phase 4's original caveat.
- Confirms Phase 3's edge-case note: dev-mode "`success`" means the
  `email_queue` row reaches `status: 'sent'` locally and the console log
  line appears — it does not mean a real email was delivered. This was
  correctly the standard used throughout this verification.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

### Verdict: SHIP IT

### One-line take
The club now gets an admin email at `info@westervillelions.org` the moment
someone submits a membership application, with only the fields the request
and precedent justify — the applicant's experience is untouched, and the
implementation is exactly what Phase 1 asked for and Phase 3 designed.

### What I did
Re-read my own Phase 1 review, then read the shipped code directly rather
than taking QA's report on faith:
- Read `src/app/api/membership-applications/route.ts` in full (116 lines) —
  confirmed the `after()` block is byte-for-byte the Phase 3 design: same
  five fields (name, email, phone, memberType, submitted-at), same local
  `esc()` helper applied to every interpolated value, same hardcoded
  recipient (`info@westervillelions.org`) and admin link
  (`https://westervillelions.org/admin/membership`), same static subject,
  placed after the successful `db.insert` and before
  `return NextResponse.json({ success: true })`. Confirmed `dob`, `address`,
  `spouseName`, `occupation`, `gender`, `sponsorName` are absent from the
  template even though they're destructured from the request body and
  persisted to the DB two lines above — the narrowing Phase 1 called for is
  real, not just claimed.
- Confirmed the pre-existing 400/500 failure paths (missing required fields,
  missing/failed Turnstile, DB-insert failure) are untouched — same message
  strings, same status codes, same position above the `after()` addition.
- Read `src/lib/email.ts` in full — confirmed `sendEmail()` never throws:
  Resend failures are caught internally and written to `email_queue` as
  `status: "failed"` with a `nextRetryAt`, and the local dev-mode branch
  (no `RESEND_API_KEY`) only logs and marks the row `sent`. This validates
  the design/QA claim that the route's `after()` callback's own
  `try/catch` is belt-and-suspenders (the only realistic throw site is the
  `emailQueue` insert itself, not the Resend call) — I didn't just trust the
  narrative, I traced the actual throw surface.
- Spot-checked the precedent this feature claims to mirror
  (`src/lib/auth/index.ts` ~line 198) — confirmed `info@westervillelions.org`,
  the same `esc()`-wrapping pattern, and the same minimal-name/email shape
  are real, not an invented citation.
- Did not start a dev server or re-run gates, per instruction — QA already
  proved the live behavior (byte-identical applicant response, correct
  `email_queue` row content, XSS-escaping via a live `<script>` payload,
  cleanup verified by re-query). My job here was confirming the *shipped
  code* matches what QA described and what Phase 1 asked for, which a direct
  read satisfies without re-running anything.

### Outputs

**Intent-vs-shipped diff:**
- Phase 1 said "an email to `info@westervillelions.org` on every successful
  submission, with a link to the relevant admin page." Shipped: exactly that,
  via `after()`. **Matches.**
- Phase 1 said (as its own deliberate narrowing) the email body should carry
  only name/email/phone/memberType/submitted-at — explicitly excluding
  `dob`/`address`/`spouseName`/`occupation`/`gender`/`sponsorName` as
  unnecessary PII-over-email. Shipped: confirmed by direct code read, those
  six fields are destructured and persisted to the DB but never touch the
  email template. **Matches.**
- Phase 1 said applicant-facing confirmation email is out of scope. Shipped:
  one `sendEmail()` call in the entire route, targeting only
  `info@westervillelions.org` — no second call, no email to the applicant's
  own address. **Matches, nothing crept in.**
- Phase 1 said recipient should be hardcoded per precedent, no configurable
  recipient. Shipped: literal string `"info@westervillelions.org"`, no env
  var, no settings table. **Matches.**
- Phase 1 said the applicant's success/failure experience must be unchanged.
  Shipped: `{ success: true }` response and all 400/500 error paths are
  byte-identical to pre-feature code (confirmed by direct read, not just
  QA's report) — the `after()` addition sits after the DB insert and before
  the return, and is non-blocking by construction. **Matches.**
- Phase 1 flagged the call-placement shape as an open design question
  (await-with-catch vs. IIFE). Phase 3 resolved it with `after()` instead of
  literally copying the precedent's bare IIFE, reasoning concretely about
  Vercel serverless function-freeze risk after a Route Handler returns — a
  case where diverging from precedent was the *more correct* choice, not
  scope drift. I weigh this as shipped-quality engineering, not a deviation
  to flag. **Acceptable, deliberate improvement over literal precedent-copying.**
- Phase 1 raised XSS-escaping of applicant-controlled strings as a
  must-have. Shipped: `esc()` applied to every interpolated field; QA proved
  it live with a `<script>` payload; I confirmed the same in the static
  code. **Matches.**
- Phase 1 marked Turnstile anti-abuse as already sufficient, no new gate
  needed. Shipped: `verifyTurnstile()` is unchanged (same fallback secret,
  same siteverify call, same 400 on failure). **Matches, unchanged as
  expected.**

**Edge cases:**
- Empty state: not applicable — no UI surface. **N/A, correctly so.**
- Failure microcopy: pass — the existing human-readable 400/500 messages
  ("First name, last name, and email are required"; "CAPTCHA verification
  failed. Please try again."; "Failed to submit application. Please try
  again.") are untouched by this feature, confirmed by direct read.
- Permission gate: pass — this is, by design, a public unauthenticated
  route with no `FEATURES.*` key; correctly no `auth()`/`hasFeature()` was
  added, confirmed by reading the full route (no import of `@/lib/auth`
  exists in the file).
- Mobile / brand consistency (`rounded-2xl`, `rounded-lg`, `ConfirmDialog`):
  not applicable — zero UI files touched, confirmed by the file list in
  Phase 4/5's Outputs sections and by there being nothing to check.
- Email failure isolation: pass — traced the actual throw surface in
  `src/lib/email.ts`; `sendEmail()` cannot itself throw past its own
  internal handling, and the one theoretical throw site (`emailQueue`
  insert) is still caught by the route's local `try/catch` inside
  `after()`, which executes on a tick after the response is already sent.

**Remaining acceptance step (not a gap):** the actual Resend delivery to the
actual `info@westervillelions.org` inbox has not been exercised end-to-end
against a real network call in this pipeline — by design, both Phase 4's
sanity check and Phase 5's live verification neutralized `RESEND_API_KEY` to
avoid sending real email during automated testing. This is the correct
tradeoff for a QA pass, not a shipped defect: the code path that would fire
in production (`sendEmail()`'s `resend.emails.send(...)` branch) is
identical regardless of which branch runs, and only the presence of a real
`RESEND_API_KEY` in production distinguishes it from what was tested. The
treasurer has said he will verify actual delivery in production himself.
That is the correct final acceptance step for this feature, not an
outstanding gap this pipeline owes him — flagging it here for the record,
not as a blocker.

**No follow-ups logged to `docs/backlog.md`.** Nothing surfaced in this
review rises to a tracked follow-up: the two Phase-1-identified out-of-scope
items (applicant confirmation email, configurable recipient) remain
correctly unshipped and undocumented as defects — they were deliberate
scope decisions, not deferred gaps, and neither has been requested as a
next step.

### Open questions / handoff notes
- None for the next agent — this closes the pipeline. If the treasurer's
  production check surfaces a real delivery problem (e.g., `info@` inbox
  never receives it despite `email_queue` showing `status: 'sent'`), that
  would be a new bug report re-entering at Phase 1, not a reopening of this
  work-log.
