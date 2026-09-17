# Sign-in shows "Welcome back!" on rejected credentials — Work Log

> **Slug:** `2026-09-17-signin-false-success-toast`
> **Surface:** public (`/signin`)
> **Permission(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phases 1, 2, 3, 5, 6 skipped (one-line client-side condition; no invariants, schema, or server logic touched). Root cause and reproduction recorded below.

---

## Root cause

`src/app/signin/page.tsx` treated `result?.ok` from NextAuth's client `signIn("credentials", { redirect: false })` as "credentials accepted". In `next-auth@5.0.0-beta.32`, `ok` is `res.ok` — the HTTP status of the callback POST — and a rejected credential still returns 200. The rejection is surfaced separately in `result.error` (`"CredentialsSignin"`). So a wrong password or unknown email showed the success toast, pushed to `/members`, and the proxy bounced the user straight back to `/signin` with no session and no explanation.

## Reproduction (pre-fix)

1. Go to `/signin`, enter any email that has no `users` row (or a wrong password), submit.
2. Observe the "Welcome back!" toast, then an immediate redirect back to the sign-in form.
3. `failed_login_attempts` records the attempt (`unknown_email` / `invalid_password`) — the server rejected it correctly; only the client misread the result.

Observed in production 2026-09-17 after deleting a test account and attempting to sign in with it.

## Fix

Success condition is now `result?.ok && !result.error`; a rejected credential falls through to the existing "Invalid email or password" toast.

## Verification

- `pnpm exec tsc --noEmit` — pass
- `pnpm lint` — pass
- Manual (pending — verify on the deploy): a rejected credential should show "Invalid email or password" and stay on `/signin`; a valid credential should still land on `/members`.
