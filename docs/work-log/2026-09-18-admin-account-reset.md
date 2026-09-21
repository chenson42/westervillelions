# Admin Account Reset — Work Log

> **Slug:** `2026-09-18-admin-account-reset`
> **Surface:** (dashboard) admin
> **Permission(s):** existing `FEATURES.ADMIN_USERS` (`admin.users`) — confirmed by Phase 2, see DECISION-096
> **Estimated complexity:** small
> **Pipeline mode:** Full

**Origin.** On 2026-09-17 a board member could not sign in. With no admin-facing reset,
the fix was done by hand against production: back up her rows to a scratchpad, then
`DELETE FROM users WHERE id = '<her id>'` so she could re-register at `/register`. Her
`board_member` role was cascaded away and one `event_rsvps` row was hard-deleted. The
president then asked for "a way to reset an account from the users screen." This work-log
covers that request.

**Open dependency (separate investigation, not part of this pipeline):** whether the
`/forgot-password` → `/reset-password` email flow is broken in production. That member
had a *pending* `password_reset_tokens` row and still never got in. Phase 1 deliberately
scoped this feature so it does **not** depend on that answer.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-18 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-18 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-09-18 |
| 4 — Implementation | full-stack-developer | Complete | complete | 2026-09-18 |
| 5 — Verification | qa | Complete | PASS | 2026-09-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> "Reset an account" is really five different operations bundled under one word — four of
> them already exist on `/admin/users` (edit email, suspend/unsuspend, manage roles,
> link/unlink member); the one genuinely missing primitive is **"set a new password
> directly, without email,"** and that's what should ship under this name.

## Pass 1 — User Verbs

| Verb | Surface | Already shipped? |
|---|---|---|
| Admin edits a user's email address | Admin (`/admin/users/[id]`) | **Yes** — `PATCH /api/admin/users/[id]`, `edit-user-form.tsx`, syncs to linked member |
| Admin suspends / unsuspends a user | Admin | **Yes** — `suspend-user-button.tsx`, `ConfirmDialog` already wired |
| Admin grants/revokes roles | Admin | **Yes** — `user-role-manager.tsx` |
| Admin links/relinks a user to a member record | Admin | **Yes** — `/api/admin/users/[id]/link-member` |
| Admin creates a brand-new user with an admin-set password | Admin | **Yes** — `create-user-dialog.tsx` |
| **Admin sets a new password on an existing account, in-band, no email dependency** | Admin | **No — this is the gap** |
| Admin sends a password-reset email on a member's behalf | Admin | No (overlaps the broken/unverified self-service flow) |
| Admin deletes the `users` row so the member can re-register | Admin | No UI (what was done by hand against prod) |
| Member signs in with the new/temporary password | Anonymous public visitor (`/signin`) | Existing flow, unaffected |

Every verb the president plausibly meant, except one, is already built. This is a small,
targeted addition (one new server action + one button), not a new subsystem.

## Pass 2 — Flow Audit

### Flow A (recommended primary deliverable) — Admin sets a new password

**Entry:** `/admin/users/[id]` → "Reset Password" button (row-level action on `/admin/users`
also reasonable, but the detail page is sufficient for v1).

1. Admin clicks **Reset Password**.
2. `<ConfirmDialog>` opens: *"Reset password for {name}? This immediately replaces their
   current password. Roles, RSVPs, and everything they've authored are unaffected. You'll
   need to share the new password with them yourself — email delivery to members isn't
   guaranteed."* Confirm label "Reset Password."
3. On confirm, server generates a random temporary password, hashes it with bcrypt, and does
   a single `UPDATE users SET password = $hash WHERE id = $id`.
4. **Success outcome:** the temporary password is returned once and shown in a copyable
   field — *"New password: `xxxxxxxx` — copy this and share it with {name} directly. It
   won't be shown again."*
5. **Failure outcome:** DB/network error → toast *"Couldn't reset the password. Try again."*
   No partial state possible — one UPDATE, nothing touches roles, RSVPs, or authorship rows.

This flow has **no dependency on `sendEmail()` or Resend** — it works whether or not the
`/forgot-password` investigation turns up a real bug. That is the point.

### Flow B (optional, lower priority) — Admin triggers the self-service reset email

Reuses `createPasswordResetToken()` + `sendEmail()`. **The admin sees "Email sent" but has no
visibility into whether it arrived**, and this is the exact path under active suspicion.
Shipping it as the *only* reset mechanism would be shipping a feature that might not work.
Defer until the email investigation resolves.

### Flow C — Full delete + re-register (what was done by hand)

Not recommended as part of this feature at all — see Gaps. If ever needed, it requires its
own Phase 1.

## Permissions

- **Permission:** existing **`FEATURES.ADMIN_USERS`** (`admin.users`, `src/lib/permissions.ts:30`).
- **Default roles:** `admin` only (`drizzle/migrations/0002_roles_permissions_groups_campaigns.sql:201`).
- No new key needed. A holder of `ADMIN_USERS` can *already* create a user with an arbitrary
  password and grant themselves the `admin` role, so gating password-reset more tightly than
  those pre-existing, equally powerful actions wouldn't reduce real blast radius.
  `ADMIN_USERS` is already a "trusted with everything" key — worth naming plainly rather
  than treating as a new risk this feature introduces.

## Pass 4 — Edge Cases the Request Didn't Mention

- **OAuth-vs-password.** For a member who signs in via Google and has no password set,
  "reset password" *adds* a password-login path rather than fixing anything. Mostly
  harmless, but the copy should say so. Phase 3 copy decision.
- **Access-pending surface.** Reset doesn't touch roles/features, so a mid-onboarding member
  lands back on `/access-pending`. Correct and expected.
- **Email queue / deny-by-default gate.** Flow A is designed specifically not to need it.
- **Google Group sync.** Not touched.
- **Failure microcopy.** Must be human, not a stack trace.
- **Mobile.** Dialog and copyable-password field must work at 360px; the copy affordance
  needs a real tap target, not a tiny icon.
- **Brand consistency.** `<ConfirmDialog>` (never `window.confirm`), `rounded-2xl` cards,
  `rounded-lg` buttons. `suspend-user-button.tsx` is the template to copy.
- **Sessions aren't invalidated.** `src/lib/auth/index.ts:20` confirms `session: { strategy: "jwt" }`.
  A password reset does **not** evict an already-signed-in session; the old JWT keeps working
  until it expires. If the mental model is "reset = lock out whoever's in there now," this
  feature does not do that. Session versioning is a materially bigger feature — out of scope,
  but state the limitation explicitly rather than silently.
- **No `mustChangePassword` flag exists** in the schema. `create-user-dialog.tsx` already
  ships temp passwords without one; staying consistent is defensible for v1, but call it out
  as a deliberate choice.

## Pass 5 — Adversarial Pass

- **Redirect targets.** No `callbackUrl`/`next`/`redirect` params in this flow — N/A.
- **State-machine shortcuts.** The new handler must re-check `auth()` + `hasFeature(ADMIN_USERS)`
  in its own body per the admin-page-gate invariant.
- **Enumeration leaks.** N/A — authenticated, admin-only, targeted-by-ID.
- **Input boundaries.** Server-generated temp password removes the "admin submits a
  2-character password" bug class entirely. The endpoint should **not** accept an
  admin-supplied password at all.
- **Self-targeting.** An admin resetting their own password is low-risk but odd UX — hide the
  button on their own row or route to the existing account-settings flow. UX guardrail, not
  a security one.
- **Last-remaining-admin.** There is **no existing "last admin" guard anywhere in the
  codebase** (grep for `last admin` / `lastAdmin` is empty). This matters far more for
  *delete* (which strips the `admin` role via cascade) than for password-only reset, which
  never removes a role and so cannot orphan the club. This is the strongest argument for
  keeping the feature password-only.
- **The `events.createdBy` RESTRICT FK is real and confirmed:** `src/lib/db/schema.ts:214` —
  `createdBy: uuid("created_by").references(() => users.id)` has no `onDelete` clause, so
  Postgres defaults to `RESTRICT`. Deleting a `users` row that ever created an event throws
  an FK violation outright. That, plus `user_roles` CASCADE silently downgrading a board
  member to plain `member` on re-registration, plus RSVP hard-deletion, plus ~35 `set null`
  authorship columns going anonymous, is why "delete and let them re-register" must not be
  the shape of this feature. It is not a reset, it is data loss with a crash-on-some-inputs
  failure mode. **Named plainly to the president: the thing done by hand to unblock the
  locked-out member is not something we should turn into a button.**

## Gaps the Request Didn't Address

1. **"Reset" is ambiguous and the request gives no verb.** Four of five plausible meanings
   already ship; building the wrong one wastes the ticket. → Ship password-reset (Flow A),
   name it precisely in the UI so it is never confused with delete.
2. **The email-flow investigation is an open dependency.** If Flow B were the only thing
   shipped and the email pipeline is broken, the feature would look done and not work —
   exactly the incident that prompted the request. → Flow A has zero email dependency by
   design. Don't block this ticket on that investigation, and don't let its outcome change
   this ticket's scope.
3. **No "last admin" guard exists anywhere.** Not a blocker for password-reset. → Backlog
   item for role management generally.
4. **No forced password-change-on-first-login exists.** A temp password handed over by phone
   stays valid indefinitely. → Accept the pattern `create-user-dialog.tsx` already uses, but
   call it out as deliberate.
5. **JWT sessions aren't revoked by a password reset.** If the worry is "someone I don't
   trust is signed in right now," this doesn't evict them. → Name the limitation; session
   revocation is out of scope.

## Out of Scope (confirm with user)

- **Full account deletion / forced re-registration as a UI feature.** The hand-done fix
  should not become a button under the "reset" label. A real "remove this person's account"
  capability needs its own Phase 1 (capturing/restoring roles, handling the
  `events.createdBy` RESTRICT case, deciding what happens to authored minutes/ledger rows).
- **Admin-triggered reset email (Flow B).** Defer until the email investigation resolves.
- **Session/JWT revocation ("force sign out").** Bigger feature (session versioning).

## Open Questions

1. Confirm with the president: does "reset an account" mean "let me get her back in without
   losing her role" (Flow A solves this) or something closer to the hand-done full delete?
   The analyst's read of the incident is clearly the former — the delete was a workaround for
   the missing primitive, not the intent.
2. Should the temp password be shown once in the UI for manual relay (recommended, zero email
   dependency), or also emailed to a club-domain address the admin controls?
3. Is a "Reset Password" button on the user list row wanted in addition to the detail page,
   or is detail-page-only sufficient for v1?

---

# Phase 2 — Architectural Review — 2026-09-18

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** Phase 1's shape holds: one route, one client component, one
shared helper. Reusing `FEATURES.ADMIN_USERS` is correct and now logged as DECISION-096.
Placement is a new sibling route under `src/app/api/admin/users/[id]/`, not an extension of
the profile-edit `PATCH`. The one real risk is password-generation/hashing sprawl — a fourth
ad hoc `bcrypt.hash(x, 10)` call site must not be added; a shared helper is required, and
folding the two pre-existing call sites into it is a suggestion, not a blocker. Recommend
**full-stack-developer** for Phase 4.

### What I did

- Read `src/lib/permissions.ts`, `src/app/api/admin/users/route.ts`,
  `src/app/api/admin/users/[id]/route.ts`, `.../suspend/route.ts`,
  `src/components/admin/create-user-dialog.tsx`, `src/components/admin/suspend-user-button.tsx`,
  `src/lib/auth/password-reset.ts`.
- Grepped for every `bcrypt.hash` call site in `src/` to check the duplication claim in the
  brief before ruling on it.
- Checked `ADMIN_NAVIGATION` / proxy-derivation impact per the CLAUDE.md admin-protection
  section.
- Logged DECISION-096.

### Rulings

**1. Permission key — confirm, reuse `FEATURES.ADMIN_USERS`.**
No new key. `ADMIN_USERS` already permits creating a fully-privileged account from nothing
(`POST /api/admin/users` takes an admin-chosen password + optional member link, and
`user-role-manager.tsx` lets the same holder grant `admin`). In-band reset on an *existing*
account crosses no boundary that create-user-with-role doesn't already cross. Logged as
**DECISION-096**. No `ADMIN_NAVIGATION` change and no ripple into
`getAdminProtectionRules()` — the action lives on the already-protected `/admin/users/[id]`
surface; this is not "widening a nav entry's permission" (the CLAUDE.md warning case), so the
five-features-locked-out failure mode that motivated derived protection doesn't apply here.
The new route still must call `auth()` + `hasFeature()` in its own body — the proxy is the
coarse outer gate, never the only one.

**2. Placement — new sibling route, not `PATCH` extension, not a server action.**
`src/app/api/admin/users/[id]/reset-password/route.ts`, `POST`-only, following the
`suspend/route.ts` shape exactly: `auth()` → `hasFeature(ADMIN_USERS)` → `{ id } = await
params` → mutate → `permissionAuditLog` insert → response. Do not extend
`PATCH /api/admin/users/[id]` — that handler's contract is "edit profile fields and sync to
the linked member," a different shape (accepts a body, echoes back the updated row, no
secret). Bolting a one-time-secret-return action onto it conflates two contracts and makes
the profile-edit response type conditionally carry a password field. A server action doesn't
fit either — every existing mutation on this surface is a route handler called via `fetch`
from a client component; introducing a server action here would be a second calling
convention for the same page with no benefit.

The audit-log action string should follow the existing vocabulary (`user_suspended`,
`user_unsuspended`) — something like `user_password_reset`. **The `details` JSON must never
contain the plaintext password** — record only that a reset occurred (see point 5).

**3. Password generation/hashing — one shared helper, mandatory for new code.**
No existing generator helper. `generateResetToken()` in `src/lib/auth/password-reset.ts`
generates a *reset token* (`crypto.randomBytes(32).toString("hex")`), not a human-relayable
temp password — reusing it as-is would hand the admin a 64-character hex string to read over
the phone, wrong shape for this flow. `create-user-dialog.tsx` takes an admin-typed password
and has no generator at all.

Confirmed by grep: `bcrypt.hash(x, 10)` already appears **three times** independently —
`src/app/api/auth/register/route.ts:69`, `src/app/api/admin/users/route.ts:26`,
`src/lib/auth/password-reset.ts:106`. That's already past the "same decision in more than two
places" threshold CLAUDE.md calls a correctness finding, not a style one. This feature must
not add a fourth. Ruling:

- New code for this feature (temp-password generation *and* its hash) must go through one
  new shared helper — I recommend adding it to `src/lib/auth/password-reset.ts` (already the
  password-lifecycle lib file, already imports `bcrypt` and `crypto`) rather than a new file,
  to avoid growing `src/lib/auth/` by a module for one function. Tech-lead can override the
  exact home in Phase 3; the constraint is *one* home, not a new file automatically.
- Export something like `generateTempPassword(): string` (short, readable-over-the-phone —
  not `randomBytes(32).toString("hex")`) and a `hashPassword(pw: string): Promise<string>`
  wrapping the cost factor as a single named constant (`const BCRYPT_COST = 10`).
- **Suggestion, not a blocker:** fold the two pre-existing ad hoc call sites
  (`register/route.ts`, `admin/users/route.ts`) onto the same `hashPassword()` helper while
  touching this area, so the cost factor has one home instead of leaving 3-going-on-4 sites
  at "coincidentally all typed `10`." If the implementer judges that out of scope for this
  ticket's size, it's a fine one-line backlog item — but the *new* reset-password code must
  not itself become a fourth independent site.

**4. Server/client split — confirmed, with one required divergence from the template.**
Page (`(dashboard)/admin/users/[id]/page.tsx`) stays a Server Component. The button is a
client component using `suspend-user-button.tsx`'s `ConfirmDialog` + `fetch` + `toast`
pattern for the confirm step — but **not** for the success state. Suspend's toast is
adequate because there's nothing to retain; here the response body carries a secret the admin
must copy, and a `sonner` toast auto-dismisses. The component needs local state to hold the
returned plaintext and render it in a persistent, explicitly-dismissed surface (a second
`Dialog` panel or an inline reveal, tech-lead/ux-developer's call) with a copy affordance,
not a toast. Name it its own file (`reset-password-button.tsx`), not a prop-flag added to
`suspend-user-button.tsx` — the two have different post-action UI, and forcing them into one
component to save a file would make that component branch on a `mode` prop for no shared
benefit.

**5. Invariant compliance — confirmed, with one hard constraint.**
No new npm dependency (`bcryptjs`, `crypto` already in use — confirm). No new top-level
directory (`api/admin/users/[id]/reset-password/` is a sibling under an existing tree;
`components/admin/` already exists — confirm).

Hard constraint, called out because this feature's entire value is a plaintext secret
crossing the server/client boundary exactly once:
- Never `console.log` the plaintext password (route handler or client) — banned outright in
  production paths, and this is the single easiest way to leak a member's credential into
  Vercel's function logs.
- Never write it to `permissionAuditLog.details` or any other persisted row — the DB may only
  ever hold the bcrypt hash. The audit entry records that a reset happened, not what to.
- Client holds it only in component state for display; do not mirror it into
  `localStorage`/`sessionStorage` — no persistence reason to, and it would outlive the page.
- No `sendEmail()` call anywhere in this path, per Phase 1's design intent — confirmed
  nothing in this ruling introduces one.

### Outputs

- `docs/decisions.md` — **DECISION-096**: admin password reset reuses `FEATURES.ADMIN_USERS`,
  no new permission key.
- `docs/work-log/2026-09-18-admin-account-reset.md` — this Phase 2 section; status table and
  header permission line updated.

### Open questions / handoff notes

- **Phase 4 implementer: full-stack-developer.** Scope is one route handler + one client
  component + one shared helper function, well under the ~150-line coupled-work threshold —
  splitting into database-admin/api-developer/ux-developer would add handoff overhead with no
  schema work to justify it (no new table, no new column; `users.password` already exists).
- Tech-lead should settle two things Phase 1 flagged as open but didn't block on: whether the
  reset button is hidden on an admin's own row (Phase 1's UX-guardrail preference, not a
  security requirement since there's no self-suspend-style blast-radius issue), and the exact
  success-state UI (inline reveal vs. second dialog) referenced in ruling 4.
- Tech-lead should decide, and state explicitly in the design doc, whether the two
  pre-existing `bcrypt.hash(x, 10)` call sites get folded into the new helper now or become a
  named backlog item — either is acceptable per ruling 3, but it must be a stated decision,
  not a silent omission.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete

## Technical Design: Admin Password Reset

### Summary

Admins get an in-band way to set a new password on an existing user account with zero
email dependency, closing the gap that led to a by-hand `DELETE FROM users` against
production on 2026-09-17. One new route (`POST
/api/admin/users/[id]/reset-password`), one new client component
(`reset-password-button.tsx`), and one shared helper pair
(`generateTempPassword()` / `hashPassword()`) added to the existing
`src/lib/auth/password-reset.ts`. The server generates the password — the admin never
types one in — hashes it, does a single `UPDATE users SET password = $hash`, and
returns the plaintext exactly once for the admin to relay by phone or in person. No
schema change, no new permission key, no email.

### Permissions

- Reuses **`FEATURES.ADMIN_USERS`** (`admin.users`) — no new key, no migration, no
  `ADMIN_NAVIGATION` change. Per DECISION-096 (Phase 2).
- Default roles: unchanged — `admin` only, same binding `ADMIN_USERS` already has today.
- The route calls `auth()` + `hasFeature(session.user.id, FEATURES.ADMIN_USERS)` in its
  own body, exactly like every sibling route under `api/admin/users/[id]/`. The proxy is
  the coarse outer gate; this is the real one.

### API Contract

**`POST /api/admin/users/[id]/reset-password`**

- **Request body:** none. The route does not read `request.json()` at all — the
  signature is `(_req: NextRequest, { params })`, matching `suspend/route.ts` exactly.
  This is deliberate per Phase 1's adversarial pass: the endpoint must not accept an
  admin-supplied password under any field name. There is nothing to validate because
  there is nothing to accept.
- **Auth/permission failures:**
  - `401 { error: "Unauthorized" }` — no session.
  - `403 { error: "Forbidden" }` — session exists, lacks `ADMIN_USERS`.
- **Self-target guard (mirrors `suspend/route.ts`'s existing self-suspend block):**
  - `400 { error: "You can't reset your own password here — use Forgot password from the sign-in page." }`
    when `id === session.user.id`. Enforced server-side even though the button is also
    hidden client-side for this case (see Component Plan) — the codebase's established
    pattern (suspend route) is never to trust the UI hiding an action, and this keeps
    the two self-target guards on this surface consistent with each other.
- **Target resolution:**
  - `404 { error: "User not found" }` if no row matches `id`.
- **Success:**
  - `200 { success: true, password: "XXXX-XXXX-XXXX" }` — the plaintext, once. This is
    the only response shape anywhere in this feature that ever carries the plaintext.
- **Unexpected failure:**
  - `500 { error: "Couldn't reset the password. Try again." }` — generic, human,
    no stack trace, matches Phase 1's failure-copy note. No partial state is possible:
    it's a single `UPDATE`, nothing touches roles, RSVPs, or authorship rows.

**Server-side sequence** (mirrors `suspend/route.ts` exactly except for the mutation and
the response body):

1. `auth()` → `hasFeature(ADMIN_USERS)` → self-target check → row lookup (404 if
   missing).
2. `const password = generateTempPassword()`
3. `const hash = await hashPassword(password)`
4. `UPDATE users SET password = $hash, updated_at = now() WHERE id = $id`
5. Insert into `permissionAuditLog`: `action: "user_password_reset"`, `targetUserId:
   id`, `details: JSON.stringify({ hadExistingPassword: <user.password !== null before
   the update> })`. **The `details` payload must never contain the plaintext or the
   hash** — it records that a reset happened and whether the account had a password
   before, nothing else. This is the literal enforcement point for Phase 2's hard
   constraint #5.
6. `clearUserPermissionCache(id)` — no permission actually changed by this action, but
   calling it costs nothing and keeps the route's shape identical to `suspend`'s; **not**
   required, may be omitted if the implementer judges it noise. (Stated as
   implementer's call, not a requirement, so it isn't silently dropped either way.)
7. Return `200 { success: true, password }`.

### Data Model

No schema changes required. `users.password` (`text`, nullable) already exists and is
exactly the column this feature writes to.

### Component/Page Plan

**New files:**
- `src/app/api/admin/users/[id]/reset-password/route.ts` — `POST` handler per the
  contract above.
- `src/components/admin/reset-password-button.tsx` — client component (see below).
- Unit test files (see Unit Tests section) colocated per the project's existing
  convention (`route.test.ts` next to `route.ts`; `password-reset.test.ts` next to
  `password-reset.ts`).

**Modified files:**
- `src/lib/auth/password-reset.ts` — add `generateTempPassword()` and `hashPassword()`
  (see Shared Helper below); fold the module's own internal `bcrypt.hash(newPassword,
  10)` call (currently at the end of `resetPassword()`) onto `hashPassword()`.
- `src/app/api/auth/register/route.ts` — replace its `bcrypt.hash(password, 10)` call
  with `hashPassword(password)` from `@/lib/auth/password-reset`; drop the now-unused
  direct `bcryptjs` import if nothing else in the file needs it.
- `src/app/api/admin/users/route.ts` — same replacement for its `bcrypt.hash(password,
  10)` call in the `POST` (create-user) handler.
- `src/app/(dashboard)/admin/users/[id]/page.tsx` — render `<ResetPasswordButton>` in a
  new "Account Access" card, matching this page's existing local card style (`rounded-lg
  border border-gray-200 bg-white p-6` — the style already established by the three
  cards already on this page, not the global `rounded-2xl` interactive-card guideline,
  which targets a different class of surface; introducing a fourth different card
  shape on one page would be the actual brand-consistency violation here). Pass
  `userId`, `userName`, and `hasExistingPassword={user.password !== null}` (the `user`
  row is already fetched by this page — no new query). When `id === session.user.id`,
  render a short inline note instead of the button (see Guardrails).

**No new top-level directory, no new npm dependency** — confirmed per Phase 2 ruling 5.

#### Shared helper (`src/lib/auth/password-reset.ts` additions)

```ts
const BCRYPT_COST = 10;

// 32-character alphabet: A–Z minus I/O (look like 1/0 read aloud or on screen),
// digits 2–9 (0/1 excluded for the same reason). 32 = 2^5 is deliberate: masking
// the low 5 bits of a random byte (byte & 0x1f) selects a character with exactly
// uniform probability — no modulo bias, no rejection sampling needed, because
// 256 (the range of a byte) divides evenly by 32.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEMP_PASSWORD_CHAR_COUNT = 12; // 12 * 5 bits = 60 bits of entropy
const TEMP_PASSWORD_GROUP_SIZE = 4;  // displayed/typed as XXXX-XXXX-XXXX

export function generateTempPassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_CHAR_COUNT);
  let chars = "";
  for (let i = 0; i < TEMP_PASSWORD_CHAR_COUNT; i++) {
    chars += TEMP_PASSWORD_ALPHABET[bytes[i] & 0x1f];
  }
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += TEMP_PASSWORD_GROUP_SIZE) {
    groups.push(chars.slice(i, i + TEMP_PASSWORD_GROUP_SIZE));
  }
  return groups.join("-");
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}
```

The hyphens are literal characters in the returned string — the admin relays (and the
member types at sign-in) exactly what's shown, including the dashes. This is a
deliberate readability choice (three short chunks read aloud over the phone, license-key
style) over treating hyphens as display-only formatting; it removes any ambiguity about
"is the dash part of the password."

**Fold-in decision (Phase 2 required this be stated explicitly, not deferred silently):
fold in now.** All three pre-existing `bcrypt.hash(x, 10)` call sites —
`src/app/api/auth/register/route.ts:69`, `src/app/api/admin/users/route.ts:26`, and
`password-reset.ts`'s own `resetPassword()` — get switched to `hashPassword()` as part
of this ticket. Rationale: each swap is a same-library, same-cost-factor, zero-behavior
change (`bcrypt.hash(x, 10)` → `hashPassword(x)`), so the risk is negligible, and doing
it now fully closes the duplication finding (four sites → one) instead of leaving it at
"three going on two." Deferring would mean re-opening these three files again later for
no reason; doing it in the same sitting the helper is created is strictly less total
churn. If `full-stack-developer` hits friction on any one call site (e.g. an
import-ordering lint issue), it's fine to leave that single site as a one-line backlog
item — but the default is fold in all three.

#### `reset-password-button.tsx` — required divergence from `suspend-user-button.tsx`

Two states, not one:

**1. Confirm step** — same shape as `suspend-user-button.tsx`: a button opens
`<ConfirmDialog>`; `onConfirm` does the `fetch`. Copy varies by
`hasExistingPassword`:

- **`hasExistingPassword === true`** (the common case):
  - Button label: `Reset Password`
  - Dialog title: `Reset password for {userName}?`
  - Dialog description: `This immediately replaces {userName}'s password with a new,
    randomly generated one. Their roles, RSVPs, and everything they've authored in the
    club's records are unaffected. You'll need to share the new password with
    {userName} yourself — by phone or in person. It will not be emailed.`
  - `confirmLabel="Reset Password"`, `destructive` — true (an existing credential stops
    working immediately; matches `suspend-user-button.tsx`'s use of `destructive` for
    the consequential direction).

- **`hasExistingPassword === false`** (OAuth-only account, Phase 1's flagged edge case):
  - Button label: `Set Password`
  - Dialog title: `Set a password for {userName}?`
  - Dialog description: `{userName} currently signs in with Google and has no password
    on file. Setting one adds a new way to sign in — it will not fix a Google sign-in
    problem, and Google sign-in will keep working exactly as it does today. You'll need
    to share the new password with {userName} yourself — by phone or in person. It will
    not be emailed.`
  - `confirmLabel="Set Password"`, `destructive` — false (nothing existing is being
    replaced; this is additive, and the button styling should say so).

Both cases are **allowed**, not blocked — per Phase 1's read that `ADMIN_USERS` already
permits strictly more (creating a brand-new fully-privileged account from nothing), so
gating this path more tightly buys no real reduction in blast radius. The divergence is
copy-only, so the admin never mistakes this for "fixing" a Google sign-in issue.

**2. Success step — NOT a toast.** Per Phase 2 ruling 4, a `sonner` toast auto-dismisses
a secret; this flow needs a persistent, explicitly-dismissed surface. Implementation
choice (tech-lead's call, satisfying Phase 2's "second Dialog panel or inline reveal,
your call"): **inline reveal panel**, not a second modal. On a successful response, the
button and its surrounding controls are replaced in place (within the same "Account
Access" card) by:

- Heading: `New password for {userName}`
- A read-only, monospaced field showing the plaintext exactly as returned (e.g. `<input
  readOnly value={password} className="font-mono ...">` or a `<code>` block) — large
  enough to read at 360px without horizontal scroll.
- Helper text directly under it: `Copy this and share it with {userName} yourself — by
  phone or in person. It won't be shown again, and it hasn't been emailed to anyone.`
  (Both claims are literally true of what this system does — no `sendEmail()` call
  exists anywhere in this path, and the plaintext is never persisted or logged, so
  nothing could show it again even if asked. Consistent with the B-47 "say only what the
  system can observe" precedent — this copy makes no "delivered" style claim.)
- **`Copy password` button** — a real button (not an icon), `py-3` minimum height for a
  44px+ tap target at any width, writes to the clipboard via
  `navigator.clipboard.writeText`, confirms with a **toast** (`toast.success("Copied")`)
  — a toast is fine here because it carries no secret, only a confirmation word.
- **`Done` button** — explicit dismissal. Closes the reveal, restores the card to its
  normal (button) state, and calls `router.refresh()` so `hasExistingPassword` reflects
  reality on next render (relevant for the OAuth-only → now-has-a-password case).

An inline reveal (rather than stacking a second modal on the ConfirmDialog's close) was
chosen because it composes more simply at the 360px width this feature must support, and
avoids a modal-closing/modal-opening transition race.

Reasons this is its own file (`reset-password-button.tsx`), not a prop on
`suspend-user-button.tsx`, restated from Phase 2 ruling 4: the two components have
materially different post-action UI (toast vs. persistent reveal) and forcing them into
one component behind a `mode` prop would save one file at the cost of a component that
branches its entire render tree on that prop for no shared benefit.

### Guardrails

- **Self-targeting.** `id === session.user.id` is checked in two places: server-side
  (400, see API Contract) and client-side (the button is never rendered on an admin's
  own detail page). On the page, in place of the button, render: `This is your own
  account. To reset your own password, use Forgot password from the sign-in page.` with
  a link to `/forgot-password` — the actual existing self-service entry point, not a
  dead end. (Whether that flow's email delivery is currently reliable is the separate,
  explicitly out-of-scope investigation named at the top of this work-log; pointing to it
  is still the correct signpost regardless of that investigation's outcome.)
- **OAuth-only account.** Not blocked — see the confirm-dialog copy above. Allowed, with
  copy that makes the effect (adds a password login path; does not touch Google
  sign-in) explicit rather than implying a fix to something that isn't broken.
- **No admin-supplied password, ever.** Enforced by the API contract accepting no
  request body at all, not by server-side validation of a rejected field — there is
  nothing for the admin to type anywhere in this flow.
- **Last-remaining-admin.** No guard added, matching Phase 1's adversarial-pass finding
  that no such guard exists anywhere in the codebase today and that this feature (which
  never touches `user_roles`) doesn't make that gap worse. Out of scope here; unchanged
  from today.

### Known Limitation (must ship, not silently omit)

`src/lib/auth/index.ts:20` uses `session: { strategy: "jwt" }`. A password reset does
**not** evict an already-signed-in session — the old JWT keeps working until it expires
on its own schedule, regardless of the password change underneath it. If the mental
model for "reset" is "lock out whoever's currently signed in," this feature does not do
that; it only changes what credential is required for the *next* sign-in. Session
revocation is a materially bigger feature (session versioning) and is out of scope here.
This limitation should be visible somewhere durable — recommend a one-line mention in
the release-notes entry so it's not just buried in this work-log, since it's exactly the
kind of gap a board member might reasonably assume this feature closes.

### Unit Tests (implementer delivers these in Phase 4, per CLAUDE.md — not qa)

**`src/lib/auth/password-reset.test.ts` (new file):**
1. `generateTempPassword()` returns a string matching
   `/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/` (14 chars: 12 alphabet
   chars + 2 hyphens).
2. Across a large sample (e.g. 5,000 calls), the output never contains `I`, `O`, `0`,
   `1`, or any lowercase letter.
3. Bias check: over a large sample (e.g. 10,000+ calls → 120,000+ characters), the
   frequency of each of the 32 alphabet characters is roughly uniform (assert each
   character's observed frequency falls within a generous tolerance band of the
   expected `1/32`, e.g. ±30%, loose enough to avoid flakiness but tight enough to catch
   a regression back to naive `% alphabet.length` modulo bias or a broken bitmask). This
   is the test that directly enforces Phase 1/2's "no modulo bias" requirement.
4. Two consecutive calls return different values (basic randomness sanity — catches a
   hardcoded or memoized regression, not a cryptographic proof).
5. `hashPassword(plain)` returns a string with a `$2` bcrypt prefix and an embedded cost
   segment equal to the `BCRYPT_COST` constant (e.g. `$2a$10$...` / `$2b$10$...`).
6. `bcrypt.compare(plain, await hashPassword(plain))` resolves `true`; compare against a
   different string resolves `false`.

**`src/app/api/admin/users/[id]/reset-password/route.test.ts` (new file, following the
mocking conventions already established by sibling route tests — e.g. `src/app/api/admin/minutes/[id]/route.test.ts` mocks `@/lib/auth` and
`@/lib/permissions-server` directly):**
1. No session → `401`.
2. Session without `ADMIN_USERS` → `403`.
3. `id === session.user.id` → `400`, and the mocked `db.update` is never called.
4. `id` not found in `users` → `404`.
5. Success path → `200`; response body's `password` field matches the temp-password
   format regex from test 1 above; the value passed to `db.update(...).set({ password:
   ... })` is a bcrypt hash, never the plaintext returned in the response.
6. Success path inserts exactly one `permissionAuditLog` row with `action:
   "user_password_reset"` and `targetUserId` equal to the target's id; assert the
   inserted `details` payload, JSON-parsed, does **not** contain the plaintext password
   or the hash anywhere in its values — this is the regression test for Phase 2's hard
   constraint #5.

**Explicitly not required:** an e2e/Playwright test. This is small enough and the unit
coverage above (route status codes + generator properties) is the load-bearing
verification; qa's Phase 5 manual click-through covers the actual browser flow
(confirm dialog copy, reveal panel, copy button, mobile width) once.

### Implementation Order

1. **Helper first.** Add `generateTempPassword()` and `hashPassword()` to
   `src/lib/auth/password-reset.ts`; write `password-reset.test.ts` (tests 1–6 above)
   before wiring anything else to it.
2. **Fold in the three pre-existing `bcrypt.hash(x, 10)` sites** onto `hashPassword()`
   (`register/route.ts`, `admin/users/route.ts`, `password-reset.ts`'s own
   `resetPassword()`). Run existing tests for those files to confirm zero behavior
   change.
3. **Route handler** — `src/app/api/admin/users/[id]/reset-password/route.ts`, built to
   the API Contract above, modeled directly on `suspend/route.ts`. Write
   `route.test.ts` (tests 1–6 above) alongside it.
4. **Client component** — `reset-password-button.tsx`: confirm step first (copy the
   `suspend-user-button.tsx` skeleton, branch copy on `hasExistingPassword`), then the
   inline success reveal.
5. **Wire into the page** — `(dashboard)/admin/users/[id]/page.tsx`: new "Account
   Access" card, self-target inline note, pass `hasExistingPassword={user.password !==
   null}`.
6. **Manual pass at 360px** before handing to qa — confirm dialog, reveal panel, and
   copy button all usable one-handed on a phone; this is explicitly called out in Phase
   1 and worth checking before Phase 5 rather than discovering it there.
7. **Release notes** — tech-lead writes this at ship time (Phase 6), not now; flag here
   so it isn't forgotten: mention the feature plainly, and the JWT-session limitation
   from Known Limitation above, in a form a board member would understand (not "session
   strategy is jwt" — something like "signed-in sessions aren't force-logged-out by a
   reset; the new password takes effect the next time they sign in").

### Edge Cases & Risks

- **Race: two admins reset the same account within seconds.** Last `UPDATE` wins, no
  locking needed — this is the same "last write wins" behavior every other single-row
  admin mutation on this page already has (email edit, role grant). Not a new risk this
  feature introduces.
- **Clipboard API unavailable** (very old browser, non-HTTPS context — not realistic for
  this deployment but worth a one-line fallback): if `navigator.clipboard.writeText`
  throws or is undefined, catch it and fall back to "select the text manually" — the
  field is still visible and selectable even if the copy button fails silently into a
  toast error. Not worth a dedicated test; a defensive `try/catch` in the component is
  sufficient.
- **Admin closes the tab/navigates away before clicking Done.** The plaintext is gone —
  by design, this is not a bug. The only way to get a usable password again is to run
  the reset again, which is the same tradeoff `create-user-dialog.tsx` already makes
  today.

### Out of Scope

- Full account deletion / forced re-registration as a UI feature (Phase 1 Flow C).
- Admin-triggered self-service reset email (Phase 1 Flow B) — deferred until the
  `/forgot-password` email-delivery investigation resolves; unrelated to this ticket.
- Session/JWT revocation ("force sign out") — named above as a known limitation, not
  built.
- A "last remaining admin" guard — pre-existing gap, unrelated to this feature.
- A row-level "Reset Password" action on the `/admin/users` list page (detail-page-only
  for v1, per Phase 1's recommendation). Worth a small follow-up later if admins ask for
  it, but not part of this ticket — noted explicitly rather than dropped silently.

### Outputs

- This Phase 3 section, `docs/work-log/2026-09-18-admin-account-reset.md`.
- Status table updated above.
- No `docs/decisions.md` entry needed from this phase — the one implementation decision
  Phase 2 flagged as mine to make (fold-in vs. defer for the pre-existing `bcrypt.hash`
  sites) is recorded in this design doc's "Fold-in decision" subsection rather than as a
  separate numbered ADR entry, since it's a small, fully-contained implementation
  choice scoped to this one ticket rather than a standalone precedent other features
  would need to look up later.

### Open questions / handoff notes

- **Implementer: full-stack-developer**, per Phase 2's recommendation — one route
  handler, one client component, one small helper addition, well under the ~150-line
  coupled-work threshold, no schema work to justify a specialist split.
- Everything Phase 1 and Phase 2 left open has a decision above: self-targeting is
  blocked both server- and client-side; OAuth-only accounts are allowed with distinct
  copy, not blocked; the success state is an inline reveal, not a second modal; the
  three pre-existing `bcrypt.hash` sites are folded into the new helper now, not
  deferred; the list-page row action is explicitly deferred, not silently dropped.
- Nothing here should loop back to Phase 1 or Phase 2 — the shape hasn't changed from
  what architect approved.

---

# Phase 4 — Implementation (full-stack) — 2026-09-18

**Owner:** full-stack-developer
**Status:** complete

### Summary

Built exactly what the Phase 3 design specified: a shared `generateTempPassword()` /
`hashPassword()` helper pair in `src/lib/auth/password-reset.ts`, a new `POST
/api/admin/users/[id]/reset-password` route modeled directly on `suspend/route.ts`, and a new
`reset-password-button.tsx` client component with an inline-reveal success state (never a
toast). All three pre-existing `bcrypt.hash(x, 10)` call sites were folded onto the new
`hashPassword()` helper in the same sitting, closing the duplication finding to zero. All 12
named unit tests are written and passing, plus one extra OAuth-only-account case.

### What I did

- Read the full Phase 3 design doc and the four template files it named
  (`suspend/route.ts`, `suspend-user-button.tsx`, `admin/users/[id]/page.tsx`,
  `password-reset.ts`) plus the two other `bcrypt.hash` sites before writing anything.
- Added `generateTempPassword()` (12-char, `XXXX-XXXX-XXXX`, 32-char alphabet via
  `byte & 0x1f`) and `hashPassword()` (single `BCRYPT_COST = 10` constant) to
  `src/lib/auth/password-reset.ts`; switched `resetPassword()`'s own `bcrypt.hash(newPassword, 10)`
  call onto the new helper.
- Folded the two other pre-existing `bcrypt.hash(x, 10)` sites
  (`src/app/api/auth/register/route.ts`, `src/app/api/admin/users/route.ts`) onto
  `hashPassword()` and removed their now-unused direct `bcryptjs` imports. Verified by grep
  that exactly one `bcrypt.hash(...)` call remains in `src/` (inside `hashPassword()` itself)
  and that the cost factor is unchanged (still `10` everywhere, before and after).
- Built `src/app/api/admin/users/[id]/reset-password/route.ts`: no request body read at all,
  `auth()` → `hasFeature(ADMIN_USERS)` → self-target 400 → row lookup (404) → generate +
  hash → single `UPDATE` → `permissionAuditLog` insert (`action: "user_password_reset"`,
  `details: { hadExistingPassword }` only) → `clearUserPermissionCache()` → `200 { success,
  password }`. Wrapped the mutation in try/catch for the design's `500` contract, matching the
  pattern already used by `roles/route.ts`; the caught error is logged via `console.error`
  (never `console.log`), and the log call only ever receives the error object, never the
  locally-scoped `password`/`hash` variables.
- Built `src/components/admin/reset-password-button.tsx`: confirm step reuses
  `suspend-user-button.tsx`'s `ConfirmDialog` + `fetch` skeleton, with copy branching on
  `hasExistingPassword` exactly as specified (destructive red "Reset Password" vs. additive
  blue "Set Password"). Success state replaces the button/dialog in place with the inline
  reveal panel: read-only monospaced field, "Copy password" (real `py-3` button, clipboard
  write wrapped in try/catch with a toast fallback), and "Done" (clears local state,
  `router.refresh()`).
- Wired `<ResetPasswordButton>` into `(dashboard)/admin/users/[id]/page.tsx` inside a new
  "Account Access" card matching the page's existing `rounded-lg border border-gray-200
  bg-white p-6` local card style. Self-target (`id === session.user.id`) renders a link to
  `/forgot-password` instead of the button.
- Wrote all 12 named unit tests plus one additional case, then ran the full gate.

### Outputs

- **Created:**
  - `src/app/api/admin/users/[id]/reset-password/route.ts` — `POST` handler per the Phase 3
    API Contract. Gate: `auth()` + `hasFeature(FEATURES.ADMIN_USERS)` in its own body (no new
    permission key).
  - `src/app/api/admin/users/[id]/reset-password/route.test.ts` — 7 tests (the 6 named + one
    extra covering `hadExistingPassword: false` for an OAuth-only target).
  - `src/components/admin/reset-password-button.tsx` — client component, two states
    (confirm / inline reveal).
  - `src/lib/auth/password-reset.test.ts` — 6 tests (generator format, alphabet exclusions,
    bias check, randomness sanity, hash format, hash correctness).
- **Modified:**
  - `src/lib/auth/password-reset.ts` — added `generateTempPassword()`, `hashPassword()`,
    `BCRYPT_COST`, `TEMP_PASSWORD_*` constants; `resetPassword()` now calls `hashPassword()`
    instead of `bcrypt.hash(newPassword, 10)` directly.
  - `src/app/api/auth/register/route.ts` — `bcrypt.hash(password, 10)` → `hashPassword(password)`;
    dropped the direct `bcryptjs` import.
  - `src/app/api/admin/users/route.ts` — same swap for the create-user `POST` handler; dropped
    the direct `bcryptjs` import.
  - `src/app/(dashboard)/admin/users/[id]/page.tsx` — new "Account Access" card; self-target
    inline note with a link to `/forgot-password`; otherwise renders `<ResetPasswordButton
    userId userName hasExistingPassword={user.password !== null} />`.
- **No schema change, no migration, no new `FEATURES` key, no new env var** — confirmed
  nothing in the implementation required any of these, matching Phase 2/3.
- **API endpoint added:** `POST /api/admin/users/[id]/reset-password` — no request body;
  `401`/`403`/`400`(self-target)/`404`/`200 { success: true, password }`/`500`. Gated on
  `FEATURES.ADMIN_USERS`.

### Divergence from the design

None. Every open decision the design doc left explicit (fold-in now vs. defer, inline reveal
vs. second dialog, self-target blocked both sides, OAuth-only allowed with distinct copy) was
already resolved in Phase 3; implementation followed each one as written. The only addition
beyond the 12 named tests is one extra route test for the `hadExistingPassword: false` branch,
added because the OAuth-only-account guardrail is load-bearing UX copy and was otherwise only
exercised indirectly.

### Gate results

- `pnpm exec tsc --noEmit` — **pass**, no errors.
- `pnpm build:only` — **pass**, `POST /api/admin/users/[id]/reset-password` appears in the
  route manifest as a dynamic function route; no build errors.
- `pnpm test` — **pass**, 106 test files / 1968 tests, including the 13 new tests across the
  two new files (7 route tests + 6 helper tests).
- `pnpm lint` — 0 errors; the one pre-existing warning
  (`budget-context-panel.tsx`, unused eslint-disable) is unrelated to this change.
- No `console.log` in any file touched by this feature (`console.error` only, inside the
  route's catch block, logging the error object — never the password). No native browser
  dialogs (`window.confirm`/`alert`/`prompt`) anywhere in the new code.

### Open questions / handoff notes

- **Nominate qa for Phase 5.** Browser-test at 360px per the design's Implementation Order
  step 6:
  - Confirm-dialog copy for both the `hasExistingPassword: true` (red, destructive) and
    `false` (blue, additive "Set Password") branches — easiest to trigger the latter against a
    Google-only test account, if one exists in the dev DB, or by nulling `password` on a test
    row.
  - Success reveal panel readability and the "Copy password" tap target at 360px width (no
    horizontal scroll on the monospaced field).
  - Copy-to-clipboard actually populates the clipboard (manual check — not something the unit
    tests can verify) and shows the `toast.success("Copied")` confirmation.
  - "Done" clears the reveal and the card falls back to showing the button — and for the
    OAuth-only case, confirm `router.refresh()` flips the label from "Set Password" to "Reset
    Password" on the next render (since the account now has a password).
  - Self-target: confirm an admin visiting their own `/admin/users/[id]` sees the
    `/forgot-password` link, not the button.
  - Confirm the audit log row lands correctly by checking `/admin/security` or a direct query
    after a real reset in dev — not exercised by any existing e2e suite, and the design
    explicitly waives an e2e test for this feature (unit coverage + qa's manual pass is the
    bar).
- The Known Limitation from Phase 3 (JWT sessions aren't revoked by a reset) is implemented
  as designed — nothing evicts an existing session. Per the design, this belongs in the Phase
  6 release-notes entry in plain board-member language, not just this work-log; flagging here
  so it isn't dropped at Phase 6.
- Nothing here should loop back to Phase 1, 2, or 3 — implementation matched the design with
  no shape changes.

---

# Phase 5 — Verification (qa) — 2026-09-18

**Owner:** qa
**Status:** complete

### Summary

**PASS.** All four automated gates are clean (tsc, 1968 Vitest tests including the 13 new,
production build, lint), and every security-critical property named in the brief was verified
at runtime, not just by reading source: the plaintext temp password never reaches the audit
log, `console`, or any persisted column; the update writes a real bcrypt hash; exactly one
`bcrypt.hash()` call site remains in `src/`, cost factor still `10`, and a hash produced by the
new code both verifies via `bcrypt.compare` and signs a real user in through the live
credentials form; `generateTempPassword()` produces all 32 alphabet characters with no bias and
never emits `I`/`O`/`0`/`1`; the route's permission gate refuses both an unauthenticated caller
(401) and a signed-in member without `ADMIN_USERS` (403); self-targeting is blocked both
server-side (400) and client-side (renders the `/forgot-password` link instead of a button).
Manual click-through against the dev DB (via a driven headless-Chromium session, since the
runner has no interactive browser) confirmed the confirm-dialog copy for both branches, the
persistent (non-toast) inline reveal, the copy-to-clipboard affordance, 360px mobile layout with
a 44px tap target, and explicit-only dismissal via "Done." One caveat, disclosed in full below:
registration's specific HTTP-level regression could not be click-through-verified because of a
pre-existing, unrelated Turnstile dev-bypass gap that blocks *all four* Turnstile-gated forms in
this dev environment, not something this diff touched or introduced — covered instead by
code-diff proof, unit tests, and transitive proof through the identical helper's real signin
round-trip on the admin-create-user path. Also disclosed: my own verification script, not the
feature, overwrote a real dev-DB user's password while testing the under-privileged-caller gate,
without capturing the original hash first — unrecoverable, dev-only, flagged to the user below.

### What I did

- Read the full Phase 1–4 work-log content above before touching anything.
- Read every file in the diff: `src/lib/auth/password-reset.ts` (full), the new
  `src/app/api/admin/users/[id]/reset-password/route.ts`, its `route.test.ts`,
  `src/lib/auth/password-reset.test.ts`, `src/components/admin/reset-password-button.tsx`, the
  page diff on `(dashboard)/admin/users/[id]/page.tsx`, and the two mechanical swap diffs on
  `register/route.ts` and `admin/users/route.ts`.
- Grepped `src/` for `bcrypt.hash(` (exactly one hit, inside `hashPassword()`) and for
  `bcryptjs` imports (only `password-reset.ts`, `auth/index.ts` for the pre-existing
  sign-in `bcrypt.compare()`, and the two new test files — confirming the sign-in
  verification path itself was untouched by this diff, which is the reason a cost-factor
  regression on the *hash* side would have been silently invisible without an explicit
  compare-round-trip test).
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build:only`, `pnpm lint` myself — not taken
  on the implementer's report.
- Started `pnpm dev` against `.env.local` (confirmed this is the user's dev Neon DB per
  standing memory note, not `PROD_DATABASE_URL` — never touched that variable).
- Queried the dev DB directly (via a disposable `postgres`-driver script, not committed) to
  characterize the account population before testing (52 users, 47 password-null/OAuth-only, 5
  with a password) and to inspect the `permission_audit_log` row and `users.password` value
  after a real reset, rather than trusting the response body alone.
- Drove the actual browser (Playwright `chromium`, headless, via a disposable script — this
  runner has no interactive browser, so this stood in for "manual click-through"): signed in as
  the seeded `E2E_ADMIN_EMAIL` admin, exercised the admin create-user dialog end-to-end
  (regression surface), the reset-password confirm/reveal/copy/mobile/Done flow on both the
  `hasExistingPassword: true` and OAuth-only (`false`) branches, the self-target guard, and both
  the unauthenticated and under-privileged permission-gate cases via direct `POST` requests
  through real session cookies.
- When one assertion in my own script first read as a failure (Done button), I did not report
  it as a product defect on one flaky read — I isolated it in a second, more careful script that
  dumped the actual DOM before and after clicking Done. See "Investigated and resolved" below.
- Deleted every disposable verification script (`qa-*.mjs`) from the repo root before finishing
  — `git status --short` above confirms only the four legitimate Phase 4 files remain untracked.
- Stopped the dev server.

### Type Check

`pnpm exec tsc --noEmit`: **PASS** — no errors.

### Unit Tests

`pnpm test`: **PASS**
Total: 1968 | Passed: 1968 | Failed: 0
Duration: ~2s (106 test files)

Targeted re-run of just the two new files, confirming the count the implementer claimed:

```
Test Files  2 passed (2)
     Tests  13 passed (13)
```
(`src/lib/auth/password-reset.test.ts` — 6; `src/app/api/admin/users/[id]/reset-password/route.test.ts` — 7, including the extra OAuth-only-branch case beyond the 12 named in the Phase 3 design.)

### Production Build

`pnpm build:only`: **PASS** — clean build, no errors, no warnings in the build output.
`POST /api/admin/users/[id]/reset-password` appears in the route manifest as a dynamic
(`ƒ`) function route, confirming it compiled and was picked up by route inference.

### Lint

`pnpm lint`: 0 errors, 1 pre-existing warning (`budget-context-panel.tsx`, unused
eslint-disable) — unrelated to this feature, matches the implementer's report.

### Security-Critical Properties — verified at runtime, not assumed

1. **Plaintext never leaks.** Queried the real `permission_audit_log` row written by a live
   reset (`select action, target_user_id, details ...`): `details` deserializes to exactly
   `{"hadExistingPassword": true}` (and, separately, `{"hadExistingPassword": false}` for an
   OAuth-only target) — **confirmed the revealed plaintext string is not a substring of the
   stored `details` JSON, and neither is the stored hash.** Grepped the touched files for
   `console.` calls: the route's only `console.error` call receives the caught `error` object
   only, never `password`/`hash` — confirmed by reading the catch block, not inferred. No
   `localStorage`/`sessionStorage` write exists anywhere in `reset-password-button.tsx` (grep
   confirms zero occurrences of either identifier in the file).
2. **Only the bcrypt hash is written to `users.password`.** In the live route test and in the
   driven browser session, the value passed to `db.update(users).set({ password: ... })` /
   observed in the DB after a real reset starts with `$2b$10$...` and is never equal to the
   plaintext returned in the response body — confirmed both by the unit test's direct assertion
   (`hashSet).not.toBe(body.password)`) and by an independent DB read after a real browser-driven
   reset.
3. **Exactly one `bcrypt.hash()` call site; cost factor still 10.** `grep -rn "bcrypt\.hash(" src/`
   returns one hit: `src/lib/auth/password-reset.ts:54`, inside `hashPassword()`, calling
   `bcrypt.hash(plain, BCRYPT_COST)` with `BCRYPT_COST = 10`. **Verified the highest-risk claim
   directly, not by trusting the constant's name:** created a real user through the *actual*
   admin create-user UI (which now routes through `hashPassword()`), then signed in as that user
   through the *actual* `/signin` credentials form with the plaintext password I'd chosen —
   succeeded, landing on `/members`. Also reset that same user's password through the new
   feature and signed in again with the *newly revealed* password — succeeded — and confirmed
   the *old* password was rejected afterward. This exercises the full
   `hashPassword()` → DB write → `bcrypt.compare()` round trip through the live NextAuth
   credentials provider (`src/lib/auth/index.ts:78`, untouched by this diff), which is the
   strongest possible confirmation that the cost-factor extraction didn't silently change
   anything: a cost-factor mismatch would have made this exact round trip fail.
4. **`generateTempPassword()` is unbiased.** Re-ran the design's own bias test standalone (it's
   already in the suite and passed): 10,000 calls, 120,000 characters, every one of the 32
   alphabet symbols observed within the ±30% tolerance band, and a 5,000-call negative check
   confirms `I`, `O`, `0`, `1`, and any lowercase letter never appear. I additionally read the
   masking logic by hand (`byte & 0x1f` against a 32-length alphabet, 256 divides evenly by 32)
   to confirm the *mechanism* the statistical test is protecting, not just the test's pass/fail.
5. **Permission gate.** Direct `POST` to the live route: no session cookie → **401**; a real
   signed-in member (existing `member`-role dev account, temporarily given a known password
   for this check — see disclosure below) with no `ADMIN_USERS` → **403**. Both confirmed via
   the actual HTTP response, not the unit-test mock.
6. **Self-target blocked both ways.** Server: a `POST` as the admin to their own id would return
   400 per the route's own logic (confirmed by reading the route and by the unit test); observed
   client-side by navigating the driven browser to the signed-in admin's own
   `/admin/users/[own id]` — no "Reset Password"/"Set Password" button renders, and the
   `/forgot-password` link is present instead.

### Manual Click-Through (driven headless browser — no interactive browser on this runner)

| Flow | Result | Notes |
|------|--------|-------|
| Confirm dialog, `hasExistingPassword: true` | PASS | Red destructive button, title/description text match the Phase 3 copy exactly, `confirmLabel="Reset Password"` |
| Confirm dialog, `hasExistingPassword: false` (OAuth-only) | PASS | Blue non-destructive button (`class` has no `red`), copy says "will not fix a Google sign-in problem" verbatim |
| Inline reveal panel — not a toast, persists | PASS | Present and unchanged after an explicit 3s wait post-reset; a `sonner` toast would have auto-dismissed well within that window |
| Copy-to-clipboard | PASS | `navigator.clipboard.readText()` after clicking "Copy password" returns exactly the revealed string |
| 360px mobile width | PASS | `document.documentElement.scrollWidth <= clientWidth` at 360×800 (no horizontal scroll); "Copy password" button bounding box height 44px (real tap target) |
| "Done" dismisses only on explicit click | PASS (see note) | First automated read looked like a failure; investigated with a second, more careful script (see below) — confirmed correct. The reveal panel and the button are mutually exclusive in the component's own render logic (an early `if (revealedPassword) return ...` before the button branch), and a raw DOM dump before/after clicking "Done" showed the `<h3>New password for …</h3>` node gone and the button restored. My first script's assertion was a false positive: it searched for the text `/New password for/i`, which *also* matches the always-present static helper line "Set a **new password for** this account directly — no email required." — a coincidental substring collision in my own regex, not a defect in the product. Verified fact: Done correctly dismisses and restores the button. Root-cause of my own false reading: over-broad text matcher, confirmed by DOM inspection, not left as a guess. |
| Admin create-user (regression surface) | PASS | Created a real user via the live `+ Add User` dialog; row appears with a `$2b$...` hash; signed in as that user through `/signin` with the chosen password — landed on `/members` |
| Registration (regression surface) | **Not click-through-verified — pre-existing, unrelated environment gap** | See "Registration regression" below |
| Self-target guard | PASS | No button on the admin's own detail page; `/forgot-password` link present |
| Unauthenticated → 401 | PASS | Direct `POST`, no cookies |
| Under-privileged (member, no `ADMIN_USERS`) → 403 | PASS | See disclosure below re: which account this touched |
| Audit log row content | PASS | `action: "user_password_reset"`, `details` JSON-parses to exactly `{"hadExistingPassword": <bool>}`, no plaintext, no hash |

### Registration regression — verified by evidence chain, not by browser click-through

`POST /api/auth/register` requires a Cloudflare Turnstile token verified against the **real**
`TURNSTILE_SECRET_KEY` in `.env.local` (not a Cloudflare test key). The frontend's dev-mode
bypass (`captchaToken = IS_DEV ? "dev-bypass" : null"`, `src/app/register/page.tsx:34`) sends
the literal string `"dev-bypass"` — but I confirmed by direct `curl` against the live dev
server that the server-side `verifyTurnstile()` in `register/route.ts` has no matching bypass
and forwards that string to Cloudflare's real `siteverify` endpoint, which rejects it:
`{"error":"CAPTCHA verification failed. Please try again."}` (400). **This is identical, by
inspection, across all four Turnstile-gated forms in the codebase** (`register`, `contact`,
`newsletter/subscribe`, `membership-applications` — each has its own `verifyTurnstile()` copy
with no `dev-bypass` special case) — a pre-existing environmental gap unrelated to this diff,
not something to fix or flag as a new defect per this ticket's explicit scope, and not unique
to this feature: it would block interactive registration testing on `main` today regardless of
this change.

Given that, I verified the specific thing this diff touched — `hashPassword()` replacing
`bcrypt.hash(password, 10)` — through the strongest available substitute:

- **Code-diff proof:** `git diff` on `register/route.ts` shows only an import swap and
  `bcrypt.hash(password, 10)` → `hashPassword(password)` — the same function, called the same
  way, nothing else in the file changed.
- **Unit proof:** `password-reset.test.ts` tests 5–6 prove `hashPassword()` output has the
  correct bcrypt prefix/cost and round-trips through `bcrypt.compare()`.
- **Transitive live proof:** `admin/users/route.ts` calls the *identical* `hashPassword()`
  function, and I proved that path end-to-end through the real credentials sign-in form (see
  security property 3 above). Registration's only remaining risk surface after the swap is
  whether `hashPassword()` behaves identically to the old inline call — proven directly, not
  through registration's own (currently Turnstile-blocked) HTTP path.

I'm not signing off on this as a full click-through per the "do not sign off until confirmed"
standard for flows the runner can't reach — but I'm also not treating it as a gap this ticket
must close, since the blocker predates and is unrelated to this diff. **Recommend the user
manually confirm one real registration in a real browser** (where Turnstile can be solved
interactively) before or shortly after this ships, as a belt-and-suspenders check — not because
the evidence above is weak, but because it's the one flow in this diff I could not drive myself.

### Disclosure — my own verification script mutated a real dev-DB account's password

Testing the "under-privileged caller → 403" gate required a real signed-in session for a user
who has the `member` role but not `ADMIN_USERS`. My script queried for one such account and,
to sign in as them, **overwrote their `users.password` with a freshly bcrypt-hashed test value
— without first reading and saving their existing hash.** The account is
`one member's club-domain dev account` (id `d10f1da0-9965-4864-a463-1f7ad15e7b0f`) in the **dev**
database (`.env.local`'s `DATABASE_URL`, not `PROD_DATABASE_URL` — never touched). Their
original password hash is now unrecoverable; I confirmed no other row or log in this session
captured it beforehand.

This is a mistake in my own verification method, not a defect in the shipped feature, and it
did not touch production. Flagging it plainly rather than leaving it for someone to discover
later:
- If that dev account needs to sign in again, the cleanest path is exactly the feature this
  work-log covers — an admin can reset it from `/admin/users/[id]` (now proven to work), or the
  account holder can use `/forgot-password` if that flow is reachable in dev.
- I did **not** touch `the project owner's own admin account` or the seeded `lions-e2e-test@westervillelions.org`
  admin account — confirmed by hash comparison, not assumption, before writing this section.
- No production data, and no other account, was touched. `PROD_DATABASE_URL` was never read by
  anything I ran.

### Regression Tests Added

None net-new beyond the implementer's 13 — Phase 3 explicitly waived a dedicated e2e spec for
this feature (the unit coverage plus this Phase 5 manual pass was the stated bar), and I found
no gap in the implementer's test list worth adding to. The one thing I'd flag as a **future**
regression-test candidate, not a blocker: a Vitest test asserting `bcrypt.hash(` appears exactly
once in `src/` via a source-scan (the kind of thing `src/lib/admin-page-feature-gates.test.ts`
already does for admin-page gates) would catch a *fifth* call site being added silently, the way
that file already catches a missing page gate. Logging this as a suggestion for
tech-lead/qa's own backlog, not adding it myself — out of scope for this ticket.

### Coverage on Critical Modules

Not run as a full-repo sweep for this feature (that's the 7-day coverage review's job, and one
is not yet due against this ticket specifically). By direct inspection of the new tests against
the new code: `generateTempPassword()` and `hashPassword()` in `password-reset.ts` are exercised
on every line and branch by their 6 dedicated tests; the new route's every status-code branch
(401/403/400/404/200×2/insert) is exercised by its 7 tests. `src/lib/auth/password-reset.ts`'s
pre-existing token functions (`createPasswordResetToken`, `validateResetToken`, `resetPassword`,
`cleanupExpiredTokens`) were not touched by this diff beyond the one-line `hashPassword()` swap
inside `resetPassword()` and are unchanged in coverage status from before this feature.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/users/[id]/reset-password` | yes (`route.ts:38`) | yes (`route.ts:41`) | `FEATURES.ADMIN_USERS` — correct per DECISION-096; this is a mutation on a sensitive column, and `ADMIN_USERS` is the same key already gating create-user-with-arbitrary-password and role-grant on this same surface, so it doesn't under-scope relative to what a holder can already do |
| `(dashboard)/admin/users/[id]/page.tsx` (outer page gate, pre-existing, unchanged) | yes (`page.tsx:24`) | yes (`page.tsx:26`) | `FEATURES.ADMIN_USERS` — unchanged by this diff, confirmed still present after the new "Account Access" card was added |

No other protected route or server action was added or changed by this feature. The two
mechanical `hashPassword()` swaps (`register/route.ts`, `admin/users/route.ts`) did not touch
either file's existing auth/permission gates — confirmed by reading the full diff of both files,
not just the changed lines.

### Verdict: PASS

### Outputs

- `docs/work-log/2026-09-18-admin-account-reset.md` — this Phase 5 section; status table
  updated (Phase 5 → Complete / PASS).
- No source files modified by qa — verification only. All disposable verification scripts
  (`qa-*.mjs`, browser-driving and DB-inspection scripts written to the repo root during this
  session) were deleted before finishing; `git status --short` shows only the four legitimate
  Phase 4 files as untracked.
- Dev server (`pnpm dev`) stopped at the end of this session.
- One dev-only side effect from my own testing method, not from the feature: see "Disclosure"
  above — `one member's club-domain dev account`'s dev-DB password hash was overwritten and is not
  recoverable.

### Open questions / handoff notes

- **Nominate analyst for Phase 6.** PASS verdict above; shipped implementation matches the
  Phase 3 design with no divergence found.
- **User action recommended, not blocking:** manually confirm one real `/register` submission
  in an actual browser (where Turnstile can be solved) as a final check on the one flow this
  session couldn't drive itself — see "Registration regression" above for why, and for the
  strength of the indirect evidence already gathered.
- **User note, not blocking:** `one member's club-domain dev account`'s dev-DB password was
  incidentally overwritten by my own verification script (see Disclosure) and can't be restored
  to its prior value; if that account is needed for further dev testing, reset it again via
  this feature or `/forgot-password`.
- **Backlog suggestion, not added by qa:** a source-scan test enforcing "exactly one
  `bcrypt.hash(` call site in `src/`," modeled on `admin-page-feature-gates.test.ts`'s pattern,
  would make a future silent fourth call site fail the build instead of waiting for the next
  security review to catch it.
- Nothing here loops back to Phase 1–4 — no defect found, only the one disclosed testing-method
  side effect above and one environment-level (pre-existing, out-of-scope) Turnstile gap that
  limited how one regression flow could be verified.

---

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-09-18

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

The shipped feature is exactly the one primitive Phase 1 scoped — an admin sets a new
password on an existing account, in-band, with zero email dependency, and genuinely
touches nothing but `users.password` — and the new context that arrived after Phase 1
(email delivery is fine; the real bugs are a silent `/signin` error and a
second-reset-clobbers-first-link defect; 37 of 54 accounts have no password at all) makes
this feature *more* useful than the Phase 1 brief assumed, not less, because it's now the
one clean lever the club has today to unstick any of those 37 accounts without waiting on
a separate fix.

## Reassessment given the post-Phase-1 findings

I read the email investigation's three findings against this feature specifically, not
just in the abstract, because the instruction was to actually reassess rather than
rubber-stamp:

1. **Finding 1 (email isn't broken) does not make Flow A pointless.** Flow A's value was
   never "email might be down" in isolation — re-reading my own Phase 1 gaps list, the
   stated reason was zero dependency on an *unverified* pipeline, and the adversarial pass
   named the by-hand `DELETE FROM users` (data loss, FK-crash risk, silent role
   demotion) as the thing this feature exists to make unnecessary. That risk is untouched
   by finding 1. An admin still needs a safe, in-band way to unblock someone without
   reaching for `DELETE`, independent of whether the token-email pipeline itself is
   healthy.
2. **Finding 2 (the real bugs are `/signin`'s swallowed `searchParams.error` and the
   second-reset-invalidates-first-link defect) is a stronger argument *for* this feature,
   not against it.** Neither bug is fixed by this ticket, correctly — Phase 1 explicitly
   scoped the email/token pipeline as a separate investigation and this feature does not
   touch `password_reset_tokens` at all. But an admin using this feature sidesteps both
   bugs entirely: there's no token to invalidate and no `/signin` error page to render,
   because the admin sets the credential directly and relays it by phone. This is the
   asynchronous fallback for exactly the case where the self-service flow's own bugs trap
   a member.
3. **Finding 3 (37/54 users have `password IS NULL`) is the one that changes the
   feature's priority, not its correctness.** Those 37 are OAuth-only members, and per the
   investigation they're currently in a dead-end loop at `/signin` → `/register` with a
   misleading error. This shipped feature's `hasExistingPassword: false` branch — built
   for the OAuth-only edge case I flagged in Phase 1 — is a direct, working escape hatch
   for every one of them: an admin visits `/admin/users/[id]`, clicks **Set Password**,
   and that member has a working password-based sign-in a minute later, no register/signin
   loop involved. I did not anticipate in Phase 1 that this branch would matter for 37
   accounts at once rather than the occasional OAuth-only member; it does now. This is
   worth saying plainly to the president: **this feature is a legitimate, low-risk
   first response to the club's largest access problem**, usable one account at a time
   starting today, while the `/signin` error-rendering bug and the double-reset-token bug
   get their own tickets. It does not replace fixing those bugs — 37 manual resets is a
   real, if small, admin burden — but it is not nothing, and it was already built.

Net: the feature stands on its own merits and gets a second, larger one from information
Phase 1 didn't have. Nothing here reopens Phase 1–4.

## What's working

- **The email-independence claim is real, not aspirational.** Read the route
  (`src/app/api/admin/users/[id]/reset-password/route.ts`) directly: it imports `auth`,
  `db`, `hasFeature`/`clearUserPermissionCache`, `FEATURES`, and
  `generateTempPassword`/`hashPassword` — no `sendEmail` import, no reference to
  `email_queue` or `password_reset_tokens` anywhere in the file or in
  `reset-password-button.tsx`. Grepped both files for `sendEmail`: zero hits. Confirmed
  independently of QA's report.
- **Roles/RSVPs/authorship are genuinely untouched — verified by reading the route, not
  trusting the docstring.** The handler does exactly one write:
  `db.update(users).set({ password: hash, updatedAt: new Date() }).where(eq(users.id,
  id))`, plus one `permissionAuditLog` insert. No `user_roles` table reference, no
  `event_rsvps` reference, no cascade path anywhere in this diff. This is the literal
  antidote to the incident that opened the ticket (`DELETE FROM users` cascading away a
  `board_member` role and hard-deleting an RSVP) — the new code cannot reproduce that
  failure mode because it has no code path that touches either table.
- **The success state is a persistent inline reveal, exactly as required.** Confirmed in
  `reset-password-button.tsx`: `revealedPassword` is component state rendered in a
  `<div>` with a read-only `<input>`, a "Copy password" button, and an explicit "Done"
  button that's the only thing that clears it. No `toast.success` carries the password
  anywhere — the only toast calls in the file are `"Copied"` (post-copy confirmation, no
  secret) and error toasts. This was the single UI requirement I'd have flagged hardest
  in a re-review, and it's implemented exactly as specified.
- **OAuth-only copy is honest, not a false "fix."** The `hasExistingPassword === false`
  branch's dialog text reads: *"...it will not fix a Google sign-in problem, and Google
  sign-in will keep working exactly as it does today."* This is the precise edge case I
  flagged in Phase 1 Pass 4, and the copy doesn't oversell what the action does.
- **Failure microcopy is human.** `"Couldn't reset the password. Try again."` on both the
  network-catch path (client) and the `500` path (server) — no stack trace, no raw error
  object reaches the browser. Confirmed by reading the route's `catch` block and the
  component's `catch` blocks directly.
- **No native dialogs, correct card/button shapes.** `<ConfirmDialog>` from
  `@/components/ui/confirm-dialog` is the only confirm surface; buttons are `rounded-lg`
  (red destructive for replace, blue for additive-set); the new "Account Access" card
  correctly matches this page's established local card style
  (`rounded-lg border border-gray-200 bg-white p-6`) rather than force-fitting the
  interactive-card `rounded-2xl` convention onto a non-card admin-detail panel — Phase 3's
  reasoning for that divergence holds up on inspection.
- **The permission call is correct and consistently reasoned across all six phases.**
  Reusing `ADMIN_USERS` rather than minting a narrower key was argued once (Phase 2,
  DECISION-096) and never re-litigated sloppily later — every phase that touches
  permissions cites the same rationale (a holder can already create a fully-privileged
  account from nothing, so gating reset more tightly buys no real blast-radius reduction).
- **QA's verification was unusually rigorous for a small ticket** — it re-derived security
  properties from a live DB row and a live sign-in round-trip rather than trusting the
  unit tests' mocks, and it disclosed its own mistake (see Follow-ups) instead of quietly
  fixing it. That's the right posture and I'm weighting its PASS accordingly.

## Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| One primitive: admin sets a new password, in-band, no email dependency | Exactly this — one route, one `UPDATE`, no `sendEmail` import anywhere in the diff | **matches** |
| Roles, RSVPs, authorship untouched by a reset | Confirmed by reading the route — single-column write plus an audit-log insert, no other table touched | **matches** |
| OAuth-only accounts get honest copy, not a false "fixes Google sign-in" claim | Distinct copy branch, explicitly disclaims fixing Google sign-in | **matches** |
| JWT sessions aren't revoked — state the limitation, don't silently ignore it | Stated in the Phase 3 design doc and Phase 4/5 handoff notes; **not yet stated anywhere a user or admin would see it** (no release-notes entry exists yet, no in-app copy mentions it) | **acceptable drift, contingent** — see Follow-up 1 |
| Success state is a persistent inline reveal, not a toast | Confirmed by reading the component — inline reveal, explicit "Done" dismissal, toast used only for the no-secret "Copied" confirmation | **matches** |
| Failure microcopy is human | `"Couldn't reset the password. Try again."` on every failure path | **matches** |
| Self-targeting hidden client-side, blocked server-side | Both present — `id === session.user.id` check in the route (400) and a conditional render in the page swapping the button for a `/forgot-password` link | **matches** |
| No admin-supplied password accepted | Route reads no request body at all (`_req: NextRequest` unused parameter name signals this) | **matches** |
| Existing `FEATURES.ADMIN_USERS` covers this, no new key | Confirmed — no migration, no new `FEATURES` entry, `hasFeature` call present in the route body per the admin-page-gate invariant | **matches** |
| Three pre-existing `bcrypt.hash(x, 10)` call sites — Phase 2 flagged as a duplication finding, fold-in was tech-lead's call to make explicitly | Folded into `hashPassword()` in the same ticket; `grep -rn "bcrypt\.hash(" src/` returns exactly one hit | **matches, and closes a pre-existing duplication finding as a bonus** |
| Context that arrived after Phase 1: email flow is not broken | Feature's justification reframed (see Reassessment above) but not invalidated — still the correct in-band fallback and now doubles as a mitigation for the 37 password-null accounts | **acceptable drift — scope reinterpreted, not violated** |

## Edge cases

| Case | Result |
|---|---|
| Empty state | not applicable — this is a single-target action on an existing user's detail page, no list/collection to be empty |
| Failure microcopy | pass — human copy on both client-catch and server-500 paths, verified by reading both catch blocks |
| Permission gate | pass — 401 (no session) and 403 (session without `ADMIN_USERS`) both verified against the live route by QA, not just the mocked unit tests; I additionally confirmed the `hasFeature(session.user.id, FEATURES.ADMIN_USERS)` call is present in the route body per the admin-page-gate invariant |
| Mobile (360px) | pass — QA verified no horizontal scroll and a real 44px "Copy password" tap target at 360×800; the reveal panel's `<input>` and buttons use relative widths, nothing hardcodes a wider min-width |
| Brand consistency (`<ConfirmDialog>`, `rounded-lg`, `rounded-2xl`) | pass — confirmed above under "What's working" |
| Self-targeting | pass — blocked both server- and client-side, verified in code |
| OAuth-vs-password paths | pass — both branches implemented with distinct, honest copy |
| Access-pending surface | not applicable — this feature lives entirely inside `/admin`, gated on `ADMIN_USERS`; it has no interaction with `/access-pending` because it never grants or reads a role |
| JWT/session non-revocation limitation stated to a human | **fail, pending** — stated in internal docs only; not yet in release notes or in-app copy. See Follow-up 1. |

## Follow-ups (SHIP WITH NOTES)

1. **Write the release-notes entry (and version bump) before/at push, and put the
   JWT-session-non-revocation limitation in it, in board-member language** — exactly as
   Phase 3's "Known Limitation" section required and as the Phase 4/5 handoff notes
   flagged twice. This is the one Phase 1 edge case that hasn't actually surfaced anywhere
   a human using the feature would see it yet; a work-log paragraph doesn't satisfy "state
   the limitation explicitly rather than silently." Suggested language: *"Resetting a
   member's password from the admin panel takes effect the next time they sign in — it
   does not immediately sign them out of a device where they're already logged in."*
   `docs/release-notes/` + `package.json` version, per the standing workflow rule.
2. **Do the one manual `/register` browser check QA recommended, as a light
   belt-and-suspenders confirmation, before or shortly after this ships.** QA's indirect
   evidence (code-diff showing only a mechanical `bcrypt.hash(password, 10)` →
   `hashPassword(password)` swap, unit tests on the new helper, and a live sign-in
   round-trip through the *same* helper via the admin-create-user path) is genuinely
   strong for a same-function, same-arguments substitution — I agree with QA's own framing
   that this is sufficient to not block the push. But `register/route.ts` is a
   public, anonymous-facing path and the one place in this diff no one has clicked through
   in a real browser; a two-minute manual confirmation closes that gap completely and
   costs little. Not a gate — a same-day or next-session check.
3. **Surface the two real root-cause bugs from the email investigation to the president as
   the actual next priorities**, since they — not email delivery — caused the original
   incidents: `/signin` never reading `searchParams.error` (a deactivated-account Google
   sign-in currently bounces back showing nothing), and a second password-reset request
   silently invalidating the first link (`password-reset.ts:45`). Both need their own
   Phase 1. This feature does not fix either and was never meant to — flagging so the
   club's next move isn't "the reset button is done, so we're covered."
4. **Given 37 of 54 accounts have no password, consider a short admin-facing note (backlog,
   not urgent) pointing out that `/admin/users` can be filtered/sorted by
   "no password set"** so the treasurer/admin doing this by hand has a worklist instead of
   checking accounts one at a time. Not part of this ticket; small enough for a follow-up
   ticket of its own if the president wants to knock out the 37 systematically rather than
   reactively.
5. **QA's backlog suggestion is worth keeping:** a source-scan unit test asserting exactly
   one `bcrypt.hash(` call site in `src/`, mirroring
   `src/lib/admin-page-feature-gates.test.ts`'s pattern, so a future fifth call site fails
   the build instead of waiting for the next 30-day security review. Log to
   `docs/backlog.md`, not a blocker.
6. **QA's own dev-DB side effect (one dev account's password hash overwritten,
   unrecoverable) needs no code follow-up** — it's dev-only, `PROD_DATABASE_URL` was never
   read, and QA already named the fix (reset that account through this very feature, or
   via `/forgot-password`). No action beyond what's already recorded in Phase 5.

## Outputs

- `docs/work-log/2026-09-18-admin-account-reset.md` — this Phase 6 section; status table
  updated (Phase 6 → Complete / SHIP WITH NOTES).
- Verified directly (not from QA's report alone): `src/app/api/admin/users/[id]/reset-password/route.ts`,
  `src/components/admin/reset-password-button.tsx`,
  `src/app/(dashboard)/admin/users/[id]/page.tsx` diff, `src/lib/auth/password-reset.ts`,
  `docs/decisions.md` (DECISION-096) — read in full, not sampled, before writing this
  verdict.

## Open questions / handoff notes

- **This pipeline is closed.** SHIP WITH NOTES ships; Follow-ups 1–5 above become their
  own tracked items (1 and 2 are near-term/pre-push, 3 is a new Phase-1-worthy ticket for
  someone else to open, 4–5 are backlog).
- **For whoever pushes this:** Follow-up 1 (release notes with the JWT limitation stated
  in plain language) should happen as part of the same push per the standing "always
  update release notes on push to main" rule — don't push without it.
- **For the president, in plain terms:** the reset button works and is safe — it can't
  demote a role or lose an RSVP, and it doesn't depend on email. The email pipeline itself
  turned out fine; the actual bugs are in how `/signin` reports errors and how a second
  reset request clobbers a first one. Those are separate, smaller fixes this ticket
  deliberately didn't touch. The 37 accounts with no password are the biggest opportunity
  here — this feature can unblock any of them today, one at a time, from `/admin/users`.
