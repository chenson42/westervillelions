# Crew code easier to copy on a phone

**Started:** 2026-11-04 · **Type:** small UX fix (bug-fix variant) · **Status:** Phase 4 complete; Phase 5 reduced to unit tests + typecheck at the user's request ("quick fix")

## Request
During the practice test the user asked for the worker code to be something "the phone will recognize as a code so it copies easier".

## Root cause
The crew message carried the code hyphenated mid-sentence (`... enter the code ABCD-EF23.`). A double-tap on a phone selects only half of a hyphenated token, and nothing told the phone the entry field takes a one-time code.

## Change
- `crewInvitation()` (`src/lib/santas-workshop/admin-actions-ui.ts`): the message now reads `Your Santa's Workshop crew code is ABCDEF23`, a blank line, then `Open <link>`. Code unhyphenated, on its own line, next to the word "code".
- Worker code card: **Copy code** copies the unhyphenated code (the large display keeps the hyphen for reading aloud).
- Code entry field (`src/components/santas-workshop/crew/code-entry.tsx`): `autoComplete="one-time-code"` (was `off`), so iOS/Android keyboards can offer a code from Messages.
- Entry already ignores case, spaces and dashes (`normalizeCrewCodeInput`), so old-style codes typed with a dash still work.
- Unchanged: the code is still never put in a URL (DECISION-121).

## Phases
- 1–3 skipped by the orchestrator: a copy/attribute change, no schema, API, permission or invariant touched; not a durable-claim path.
- 4: inline by the orchestrator, ~6 lines. `admin-actions-ui.test.ts` updated to pin the unhyphenated code and the absence of the hyphenated form.
- 5 (reduced): `vitest` on `src/lib/santas-workshop` + `src/components/santas-workshop` 1248/1248 pass; `tsc --noEmit` clean. Not run: full suite, build, e2e, a real phone. Whether a given phone offers the alphanumeric code as a one-time code is untested; the one-tap selection gain does not depend on it.
- 6: not run.
