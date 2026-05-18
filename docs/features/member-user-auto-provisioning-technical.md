# Technical Design: Member User Auto-Provisioning

**Date:** 2026-05-17
**Status:** Ready for implementation
**Agent:** full-stack-developer

---

## Summary

Every member-creation path (direct admin create, application approval, future bulk import) must produce a linked `users` row, a "member" role assignment, a 24-hour password-reset token, and a welcome email. Today only the application-approval path does this. We extract that logic into a shared `provisionUserForMember` helper, drop it into `POST /api/admin/members`, and tighten the email column so future orphans are structurally impossible.

---

## 1. Shared Helper

### Location: `src/lib/members.ts` (new file)

Neither `src/lib/users.ts` nor `src/lib/provisioning.ts` exist today. The helper touches the `members` table's side of the link (`users.memberId`) so it belongs alongside other member-domain logic. `src/lib/events.ts` is the precedent for a lib file named after the domain entity.

This is a plain exported async function — no class, no service layer.

### Signature

```typescript
export async function provisionUserForMember(input: {
  email: string;
  firstName: string;
  lastName: string;
  memberId: string;
}): Promise<{ userId: string; wasExisting: boolean }>
```

### Logic (in order)

1. Normalize: `lowerEmail = input.email.toLowerCase()`.
2. Case-insensitive existing-user lookup: `WHERE lower(email) = lowerEmail` using a Drizzle `sql` template or `ilike`.
3. **If existing user found:**
   - If `existingUser.memberId` is non-null and `existingUser.memberId !== input.memberId` → throw `Error("EMAIL_CONFLICT: user already linked to another member")`. The caller catches this and returns a 409.
   - Otherwise: update `users.memberId = input.memberId` and return `{ userId: existingUser.id, wasExisting: true }`. Do not send a welcome email or generate a token.
4. **If no existing user:** insert a new `users` row (`email = lowerEmail`, `name = fullName`, `isActive = true`, no password).
5. Look up the "member" role by name. If the role row is missing, log a warning but do not throw — provisioning should not fail on a missing seed row.
6. Insert `user_roles` row for the new user.
7. Generate token: `generateResetToken()` from `@/lib/auth/password-reset`, SHA-256 hash it, insert into `password_reset_tokens` with `expiresAt = now + 24h`. (Mirror the pattern in the application-approval flow exactly.)
8. Call the `sendWelcomeEmail` private function (move it to this module — see section 5).
9. Update `users.memberId = input.memberId`.
10. Return `{ userId: newUser.id, wasExisting: false }`.

### Error conditions the caller must handle

| Thrown string prefix | HTTP response |
|---|---|
| `EMAIL_CONFLICT` | 409 "A user account already linked to a different member exists for this email" |
| Any other throw | 500 |

The helper does not return HTTP responses — it throws so callers stay in control of the response shape.

---

## 2. Migration Strategy

### Migration file: `drizzle/migrations/0035_members_email_not_null.sql`

```sql
-- Migration 0035: Enforce email NOT NULL and case-insensitive uniqueness on members

ALTER TABLE members ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique_ci
  ON members (lower(email));
```

**Idempotency:** `ALTER COLUMN ... SET NOT NULL` is idempotent — re-running on a column already `NOT NULL` is a no-op in PostgreSQL. The index creation uses `IF NOT EXISTS`. Pre-flight survey confirmed 0 null emails and 0 case-insensitive duplicates, so the constraint will apply cleanly on first run.

### Drizzle schema change (`src/lib/db/schema.ts`)

In the `members` table definition, change:

```typescript
email: text("email"),
```

to:

```typescript
email: text("email").notNull(),
```

No Drizzle-level unique index annotation is needed for the expression index (`lower(email)`) — Drizzle does not support expression indexes declaratively. The constraint is enforced at the DB level via the migration; the schema file just reflects `notNull()`. Add a comment referencing the migration for clarity.

---

## 3. Email-Change Handling on PATCH

The `PATCH /api/admin/members/[id]/route.ts` already updates `users.email` when the member email changes (lines 66-76 of the current file). That covers the login-preservation requirement.

**What happens to each related record:**

- `users.email` — already updated by the existing PATCH handler. No change needed.
- `accounts` rows (NextAuth Google OAuth) — the `accounts` table is keyed by `(provider, providerAccountId)`, not by email. The `providerAccountId` for Google is the Google account's stable numeric ID. Changing `users.email` does not break the OAuth link. The member will continue to sign in with Google as long as the Google account's address still matches the new `users.email` (NextAuth looks up the user by `providerAccountId` on OAuth sign-in, then compares `users.email` on profile sync). **Decision: leave `accounts` rows alone.** No action needed on email change.
- `password_reset_tokens` — keyed by `userId`, not email. Existing tokens remain valid after an email change, but they will send the link to the old email address (the token was already sent). This is acceptable — the token expires in 24h and the next forgot-password request will use the new email. No cleanup required.

**Additional PATCH requirement (from requirements doc):** If email changes and the member has no linked user at all (legacy orphan), call `provisionUserForMember` as a side effect. Add this check after the current `emailChanged` block:

```
if (emailChanged && data.email && updated.memberId === null) {
  // legacy orphan — provision now
  await provisionUserForMember({ email, firstName, lastName, memberId })
}
```

**Email validation on PATCH:** Add the same 400 guard as POST: if `data.email` is missing or empty, return `400 "Email is required"`. Also add a 409 guard for duplicate email across other members (query `members WHERE lower(email) = lower(data.email) AND id != id`).

---

## 4. Welcome Email Content

The `sendWelcomeEmail` function is currently defined inline at the top of `src/app/api/admin/membership-applications/[id]/route.ts` (lines 13–37). The body reads:

> "Click the button below to set your password and activate your member portal account"
> "This link expires in 24 hours."

**The current template does not mention Google OAuth sign-in as an alternative.**

This matters: a member whose Google account email matches their member email can skip the set-password step entirely and sign in with Google. The template should add one sentence after the button, e.g.:

> "Alternatively, if your Google account uses this email address, you can sign in directly with Google — no password needed."

**Resolution of open question 2:** Update the email template when moving `sendWelcomeEmail` to `src/lib/members.ts`.

**Template wording for direct admin creates:** The current subject and body refer to "membership application approved." For members created directly by an admin, the lead copy should differ slightly. Parameterize with a `context: 'application' | 'admin'` argument, or use a single neutral body:

> "Your member portal account has been created. Click below to set your password..."

Simplest approach: one neutral template used everywhere. The subject "Welcome to the Westerville Lions Club — Set Up Your Account" already works for both paths.

---

## 5. Refactor of Application-Approval Flow

Move `sendWelcomeEmail` out of the application-approval route and into `src/lib/members.ts` (consumed internally by `provisionUserForMember`). Then replace lines 83–135 of `membership-applications/[id]/route.ts` with a single call:

```typescript
const { userId } = await provisionUserForMember({
  email: application.email,
  firstName: application.firstName,
  lastName: application.lastName,
  memberId: newMember.id,
});
```

**Byte-identical behavior check:**

| Step | Current approval flow | After refactor |
|---|---|---|
| User lookup | `eq(users.email, application.email.toLowerCase())` | same (`lowerEmail`) |
| User creation | `email = lowerEmail`, `name = fullName`, `isActive: true` | identical |
| Role assignment | findFirst by `roles.name = "member"` | identical |
| Token TTL | `now + 24h` via `setHours(+24)` | identical |
| Token storage | SHA-256 hashed | identical |
| Email send | `sendWelcomeEmail(email, fullName, token)` | same call, moved module |
| `users.memberId` link | `update users set memberId = newMember.id` | identical |

One **minor behavioral difference to call out:** The current approval flow skips role assignment, token generation, and welcome email when `existingUser` is found (the `if (!existingUser)` branch). The helper preserves this: when `wasExisting = true`, steps 5–8 are skipped. This is correct — don't send a welcome email to someone who already has an account.

Another difference: the current flow does not throw on `EMAIL_CONFLICT` (existing user already linked to another member). The helper adds that guard. In practice this cannot occur during approval because a member row doesn't exist yet when an application is approved, but the guard is safe to add.

---

## 6. API Response Shape

### POST response

Return the new member object with an added `userLinked` field:

```typescript
{
  ...newMember,           // all member columns
  userLinked: 'created' | 'existing'
}
```

`'created'` when `provisionUserForMember` returns `wasExisting: false`; `'existing'` when an existing user account was linked.

**Does the admin members UI consume this?** The new-member page (`src/app/(dashboard)/admin/members/new/page.tsx`) currently redirects to the member list on success and does not read any fields from the POST response body beyond checking for a non-error status. The `userLinked` field will be ignored by the current UI.

It is still worth including in the response for:
- Future admin toast differentiation ("Member created — welcome email sent" vs. "Member created — linked to existing account")
- API consumers and debugging

No UI change is required to surface this in the current sprint, but the field should be returned from the API regardless.

---

## 7. Test Plan

**Project testing conventions:** No test files (`*.test.*` or `*.spec.*`) exist anywhere in the repo. There is no test runner configured. Tests for this feature should be added as documentation of expected behavior for manual QA, not as automated tests, unless the developer sets up a test harness as a separate effort.

**Manual QA checklist (from requirements doc, annotated with implementation specifics):**

| Scenario | How to verify |
|---|---|
| Create member, new email | Member row + user row in DB; `user_roles` has member role; `password_reset_tokens` has row expiring ~24h out; email_queue has "welcome" row; `users.member_id` points to new member |
| Create member, email matches existing user with no member_id | `users` count unchanged; `users.member_id` updated; no new `password_reset_tokens`; no new email_queue row |
| Create member, email matches existing user already linked to different member | 409 response; no rows inserted |
| Create member, email matches existing member (different person) | 409 at DB level (unique index) or at pre-check; no rows inserted |
| Create member, missing email | 400 response |
| Create member, email differs only in case from existing member | 409 (unique index on `lower(email)`) |
| Edit member, change email | `users.email` updated; no new email_queue row; password_reset_tokens unchanged |
| Edit member, change email to one used by another member | 409 |
| Edit member with no linked user (legacy) | User provisioned; welcome email queued |
| Edit member, omit email | 400 |
| Approve membership application | Unchanged behavior; check that `provisionUserForMember` produces same DB state as old inline code |
| Migration re-run | Second run is no-op; no errors |

**Helper unit tests (if a test harness is added later):**
- `provisionUserForMember` with brand-new email → creates user + role + token
- `provisionUserForMember` with existing user email, no member_id → links, returns `wasExisting: true`, no token
- `provisionUserForMember` with existing user email, different member_id → throws `EMAIL_CONFLICT`

---

## 8. Risks and Open Items

**Risk: `boardPosition` field not being set on PATCH.** The current PATCH handler at line 47-63 does not include `boardPosition` in the set clause even though the schema has it. This is a pre-existing gap, not introduced by this feature. Note it but do not fix it in this PR.

**Risk: `sendWelcomeEmail` import cycle.** Moving `sendWelcomeEmail` to `src/lib/members.ts` which imports from `src/lib/email.ts` creates no cycle. The application-approval route will import from `src/lib/members.ts`. Verify there is no reverse dependency before moving.

**Risk: token collision.** `generateResetToken()` generates 32 random bytes (256 bits). Collision probability is negligible. The `password_reset_tokens.token` column has a `UNIQUE` constraint — if a collision occurred the insert would throw a `23505` error. The probability is low enough that no retry loop is needed, but the caller's catch-all 500 handler will surface it if it ever happens.

**Risk: welcome email failure on admin create.** `sendWelcomeEmail` is called inside `provisionUserForMember` which is called inside the POST handler. If the email send fails (all 3 Resend attempts exhausted), `sendEmail` returns `{ success: false }` rather than throwing — the email lands in the `email_queue` with `status = 'failed'` for admin retry. The member and user rows are already committed. This is the correct behavior: provisioning should not roll back because an email bounced.

**Risk: `ilike` vs. `sql` for case-insensitive lookup.** Drizzle supports `ilike` for pattern matching but it requires a `%` wildcard. For exact case-insensitive equality, use `sql\`lower(${users.email}) = ${lowerEmail}\`` in the `where` clause. This is consistent with how the migration index is defined.

**Resolved: accounts rows on email change.** Leave `accounts` rows untouched. Google OAuth resolves the user by `providerAccountId`, not email, so the OAuth link survives an email rename. Documented in section 3.

**Resolved: welcome email body.** Template needs the Google OAuth sign-in note added. Documented in section 4.

---

## 9. Files Summary

### New files
- `drizzle/migrations/0035_members_email_not_null.sql`
- `src/lib/members.ts` — `provisionUserForMember` + `sendWelcomeEmail` (moved from application route)

### Modified files
- `src/lib/db/schema.ts` — `members.email` changed to `.notNull()`
- `src/app/api/admin/members/route.ts` — email required validation, duplicate check, call `provisionUserForMember`, return `userLinked` field
- `src/app/api/admin/members/[id]/route.ts` — email required validation, duplicate check, legacy-orphan provision side effect
- `src/app/api/admin/membership-applications/[id]/route.ts` — replace inline provisioning block with `provisionUserForMember` call; remove inline `sendWelcomeEmail` definition
- `src/app/(dashboard)/admin/members/new/page.tsx` — mark email field required (asterisk + `required` attribute), surface 409 error inline
- `src/app/(dashboard)/admin/members/[id]/page.tsx` — same email UI hardening

### Unchanged
- `src/lib/auth/password-reset.ts` — `generateResetToken` is imported as-is; no changes
- `src/lib/email.ts` — `sendEmail` is imported as-is; no changes
- All other routes and components
