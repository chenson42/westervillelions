# Santa's Workshop cookie at pickup (replaces drop-off snack) — Work Log

> **Slug:** `2026-10-31-santas-workshop-cookie-copy`
> **Surface:** mixed (public copy, privacy page, crew screens, two admin labels)
> **Permission(s):** existing; none added
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1-3 abbreviated by the orchestrator (small copy and crew display change; no schema, no new API route, no permission change)

## Request

Howard (event logistics volunteer) says there will be no snack at drop-off. Each stuffy instead comes home at pickup with an iced sugar cookie from Mrs. Claus for the child; families who cannot have one choose an alternative. The site maintainer approved this wording (fixed choices, no free text so no medical details invited, no-allergen-promise line kept):

- FAQ question: "What about a cookie?"
- FAQ answer: "Your stuffy comes home with an iced sugar cookie from Mrs. Claus for your child. If your child can't have one, choose a wrapped store-bought treat or no treat on the sign-up form. We cannot promise that any treat is free of allergens."

The exact alternative is undecided, so it lives in one constant (`TREAT_ALTERNATIVE`). Registration opens 2026-11-08.

## Phases 1-3 (abbreviated, orchestrator)

- No schema change, no migration, no new route, no new permission.
- The crew-contract least-data invariant is touched only by moving a non-contact field (the choice) from the check-in card to the pickup card.
- DB column `snack`, the Zeffy question-map key `snack`, the payment mapper and the admin question-field label "Snack choice" are intentionally unchanged.

## User to-do (calendar reminder set for 2026-11-05)

Change the Zeffy form question to the new choices, reassign the question text to the snack field in the admin question map, then Remap.

## Phase 4 — Implementation (full-stack) — 2026-10-31

**Owner:** full-stack-developer
**Status:** complete

### Summary
Replaced the snack copy with the approved cookie/treat wording, updated the privacy wording in both places, and moved the choice from the drop-off check-in card to the pickup card so the volunteer handing over the stuffy sees it.

### What I did
- `copy.ts`: `SNACK`/`SNACK_CHOICES` replaced by `TREAT` and `TREAT_ALTERNATIVE`; FAQ entry, `PRIVACY_ASKED` ("a treat choice") and `PRIVACY_USE` ("to send home the right treat") updated.
- Privacy page: same two wording changes.
- Crew contract: `snack` removed from `CrewCheckInCard`; `treat: string | null` added to `CrewPickupCard`; header comment updated. `crew-queries.ts` fills `treat` from `s.snack` on the pickup view only. No route change: the pickup card is already served by the existing card route.
- Pickup panel shows a "Treat" card with the "None chosen. Ask the family." fallback. Check-in panel keeps the care note only.
- Admin labels: "Treat choice (optional)" in manual add, "Treat" in the registrants table.
- Tests: `copy.test.ts` pins the exact sentence plus no-promise line and no allergy/snack wording; `crew-contract-no-contact.test.ts` allow-list now `treat: ["CrewPickupCard"]` and a new test asserts the choice rides the pickup card and not the check-in card.

### Deviations from the design
- Removed the choice from check-in (no snack at drop-off) rather than keeping it on both screens.
- Left "Snack choice" in `question-fields.ts` and "No snack choice" in `admin-ui.ts` (test-pinned admin mapping vocabulary tied to the Zeffy question text).

### Gates
tsc clean; lint 0 errors (1 pre-existing warning in `budget-context-panel.tsx`); Vitest 332 files / 5774 tests pass; `pnpm build:only` passes.

### Open questions / handoff notes
- Browser check: crew pickup screen shows the Treat card before and after "Show the name on the order"; check-in shows care note only; FAQ and `/privacy` text.
- The alternative treat is generic until decided: edit `TREAT_ALTERNATIVE`.
- Next agent: qa (Phase 5), light.

## Phase 5 — Verification — 2026-10-31

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** Type check, the full Vitest suite and the production build are green on the tree as measured (re-run independently). The FAQ, the in-page privacy section and `/privacy` render the approved wording with no "snack" left; the crew pickup card shows the treat (and "None chosen. Ask the family." when empty) and the check-in card shows the care note only. QA found one defect in the test suite, not the feature: `e2e/santas-workshop-crew-flow.spec.ts` still asserted the old check-in snack card and failed on it. QA updated that spec and added coverage; it now passes (12/12). Nothing blocks a push.

### What I did
- `pnpm exec tsc --noEmit`: PASS (exit 0, again after the e2e edit).
- `pnpm test`: PASS, 332 files / 5774 tests, 4.9 s.
- `pnpm build:only`: PASS, 0 warnings or errors in the log; `/privacy` and `/santas-workshop` still static (`○`).
- `eslint` on the edited e2e spec: clean.
- Started my own dev server on :3100 (nothing was on :3000, none touched); stopped it afterwards (port confirmed free). Page checks ran with `SANTAS_WORKSHOP_NOW=2026-11-10T12:00:00Z` (page state `open`); the e2e run used the real clock.
- **Check 1, `/santas-workshop`** (HTTP 200, visible text extracted with scripts stripped): FAQ question "What about a cookie?" with the exact approved answer; the Your-privacy section reads "...and a treat choice." and "...to send home the right treat." Zero "snack" matches.
- **Check 2, `/privacy`** (HTTP 200): "a treat choice" and "to send home the right treat"; zero "snack" matches (the only "cookie" hit is the unrelated Google Analytics paragraph).
- **Check 3, crew screens** via Playwright (real browser, 360 px phone context, practice session in the dev DB; there were none before, so the spec creates and removes its own). Pickup card shows "Treat" with "Apple slices" both before and after "Show the name on the order"; a stuffy with no choice shows "None chosen. Ask the family."; check-in shows the care note and neither "Snack choice" nor the choice value; the roster, pickup-check and pickup responses still contain no parent data. API-level: `?view=pickup` returns `treat`, `?view=checkin` has neither `snack` nor `treat`.
- **Check 4, grep** (`src/`, `public/`, `docs/marketing/`, `next.config.ts`) for "snack": no user-visible public or crew string remains. Hits are only the intentionally unchanged items: DB column and mapper identifiers, the question-map label "Snack choice" (`question-fields.ts`), the admin attention label "No snack choice" (`admin-ui.ts`), and the `banned.ts` reason strings. See note 1 below.
- **Check 5, banned list:** ran `bannedHits()` on `TREAT`, `PRIVACY_ASKED`, `PRIVACY_USE`, the FAQ question and `TREAT_ALTERNATIVE`: no hits. "free of allergens" does not match `/allerg(y|ies)|allergen-free/`. `copy.test.ts` also scans every copy string and passes.

### Regression Tests Added / changed (QA-owned, e2e only)
- `e2e/santas-workshop-crew-flow.spec.ts` (stale assertions, fixed): "bind a sticker" now expects `Snack choice` to be absent; "check in with a photo" expects the care note and no snack value/label; the pickup test expects "Treat" and the choice before and after the name reveal.
- New test "the treat choice rides the pickup card only; a stuffy with none chosen says so" (adds a fourth practice stuffy, "Nilo", with an empty choice) — guards against: the cookie choice drifting back onto the drop-off card, or an empty choice rendering as a blank instead of "None chosen. Ask the family.".
- Unit-level tests from Phase 4 (`copy.test.ts` exact sentence, `crew-contract-no-contact.test.ts` card placement) re-verified passing.
- Before the spec edit, the unmodified spec failed at `getByText('Snack choice')` (line 77) with the new code, which is how the stale assertion was found. Related specs run on the same server: `santas-workshop.spec.ts`, `-crew-admin`, `-crew-entry` = 22 passed, 1 skipped (pre-existing conditional skip, not examined). The full 12-minute suite was not run.

### Feature-Gate Audit
No protected routes added or changed. The only server-side change is the field set inside `getViewCard()` (`crew-queries.ts`), reached solely through `GET /api/santas-workshop/crew/[slug]/stuffies/[id]`, which calls `requireCrew()` first (the crew code gate, by design not `auth()`/`hasFeature()`; DECISION-121/122). The crew DTO least-data scan passes: `treat` is a non-contact field allowed only on `CrewPickupCard`.

### Outputs
- `/Users/cshenso/git/westervillelions/e2e/santas-workshop-crew-flow.spec.ts` (edited by QA, uncommitted)
- This work-log section.

### Open questions / handoff notes
1. **Non-blocking, visible to admins/the chair:** the admin attention flag `missing_snack` still reads "No snack choice" (`admin-ui.ts`) and the question map field "Snack choice". Intentional and test-pinned per Phase 4; relabel only together with the Zeffy question rename (user to-do, reminder 2026-11-05), and note the question-map text match is on the Zeffy question text, so reassigning after the form change is required or the choice will not map (missing_snack flags).
2. **Undisclosed small addition in Phase 4:** the check-in card now shows "No care note from the family." when there is no care note (previously the section was simply absent). Harmless and sensible; not listed under "Deviations".
3. **Not verified:** the copy's promise that the Zeffy form offers "a wrapped store-bought treat or no treat" depends on the user editing the Zeffy form; until then the live form still says the old snack choices. Registration opens 2026-11-08, so the form change (reminder 2026-11-05) must land before the copy is relied on. `TREAT_ALTERNATIVE` is still generic.
4. The working tree still carries unrelated uncommitted edits (`docs/backlog.md`, `docs/work-log/2026-10-17-itemized-sweep-inc2b-sweep-batch-ui.md`); left untouched. Nothing was committed or pushed; no email was sent (practice session, no mail path).
5. Next agent: `analyst` for Phase 6.

## Phase 6 — Shipped vs Intent — 2026-10-31

**Owner:** analyst
**Status:** complete

### Summary
**Verdict: SHIP WITH NOTES.** The code delivers the approved intent: no snack at drop-off, an iced sugar cookie from Mrs. Claus at pickup, fixed alternatives, the no-allergen-promise line kept, the pickup volunteer sees the family's choice, and the privacy wording matches in both places. The notes are all about the one thing the code cannot control: the Zeffy form still offers the old snack choices until the user edits it (reminder 2026-11-05). That gap is harmless only because the form is not embedded before registration opens on 2026-11-08, and it needs one confirmation step (below) so the first real orders map correctly.

### What I did
- Re-read the request, approved wording, Phase 4 handoff and QA's PASS; read the full code diff (copy, privacy page, crew contract, crew query, check-in and pickup panels, admin labels, tests, e2e).
- Grepped `src/`, `public/`, `docs/marketing/`, `next.config.ts` for "snack": no user-visible public or crew string remains. Remaining hits are identifiers, test fixtures, the `banned.ts` reasons, and the two intentionally unchanged admin labels.
- Did not re-run the browser checks; I rely on QA's evidence (gates green, FAQ/privacy/crew screens verified, e2e 12/12) plus the diff, which matches it.

### Intent-vs-shipped diff
- No snack at drop-off. Phase 1 said remove it. Shipped: choice removed from `CrewCheckInCard`, check-in panel shows only the care note; contract test and e2e guard against it drifting back. Verdict: matches.
- Cookie at pickup, wording. Approved FAQ question and answer. Shipped: `TREAT` is exactly the approved sentence (pinned verbatim in `copy.test.ts`), FAQ question "What about a cookie?", alternative in one constant `TREAT_ALTERNATIVE`. Verdict: matches.
- Fixed alternatives, no free text. Shipped copy names only "a wrapped store-bought treat or no treat"; no medical-detail prompt added. Verdict: matches.
- No-allergen-promise line kept. Shipped: "We cannot promise that any treat is free of allergens."; banned-word scan clean ("free of allergens" does not trip the allergy pattern). Verdict: matches.
- Volunteer at pickup sees the choice. Shipped: "Treat" card on the pickup panel, visible before and after the name reveal, "None chosen. Ask the family." when empty; value rides only `CrewPickupCard`, a non-contact field, behind `requireCrew()`. Verdict: matches.
- Privacy wording. Shipped: "a treat choice" and "to send home the right treat" in `PRIVACY_ASKED`/`PRIVACY_USE` and in `/privacy`, both statically rendered. Verdict: matches.
- Admin labels. Phase 4 relabelled manual-add ("Treat choice (optional)") and the registrant detail row ("Treat", "No treat choice recorded"); left the question-map field "Snack choice" and attention flag "No snack choice". Verdict: acceptable drift (see follow-up 2; an admin now sees "Treat" in one place and "snack" in another).
- Undisclosed Phase 4 addition: check-in card says "No care note from the family." when empty. Verdict: acceptable drift. It is the right empty state (the card would otherwise be a blank panel now that the snack row is gone), tiny, no schema or API. It should have been listed under "Deviations".

### Public promise vs the unchanged Zeffy form
- The FAQ and privacy text now promise a treat choice on the sign-up form that the live form does not yet offer (it still asks "Snack choice": regular, nut-free, dairy-free, gluten-free or no snack).
- Exposure is limited: the Zeffy iframe renders only in the `open` state (2026-11-08, with a non-empty URL), so nobody can submit the old form through the site before the user's 2026-11-05 edit. A browsing visitor sees a sentence about a form they cannot yet reach. The FAQ shows in every state, so this window is real but harmless.
- The hard dependency is the ordering: Zeffy form edit (11-05) must precede 11-08. If the push to production happens before 11-05, nothing breaks; if the form edit slips past 11-08, the site promises choices the form lacks.
- Second-order effects of the form edit: the question-map match is on the Zeffy question text, so a renamed question stops matching until reassigned to the snack field, and every order in between is flagged `missing_snack`, with no treat shown to the volunteer. Remap fixes it. Any order placed on the old vocabulary (for example "Gluten-free") would show on the pickup card as "Treat: Gluten-free", which is meaningless to a volunteer holding a cookie tray.

### Edge cases
- Empty state (no choice): pass. Pickup card says "None chosen. Ask the family."; check-in says "No care note from the family."
- Failure microcopy: pass. Card load error path unchanged (human message, red text); the Treat card renders only when the card is ready.
- Permission gate: pass. No route added; `requireCrew()` first; contact-data scan passes.
- Mobile (360 px): pass per QA's phone-context run.
- Brand consistency: pass. The new pickup card reuses `CREW_CARD`; no new buttons or dialogs.
- Both user paths (OAuth/password), email queue, Google Group sync: not applicable (crew code-gate and static copy only).

### Follow-ups (SHIP WITH NOTES)
1. **Zeffy form change, user, 2026-11-05 (reminder exists).** Do these in order: edit the form question and choices (cookie as default, the wrapped store-bought treat, no treat); then in `/admin/santas-workshop` reassign the new question text to the snack field in the question map; then Remap; then confirm no order shows `missing_snack` and the pickup "Treat" values read as the new choices. Place a practice order on the practice form first if there is one. Hard deadline before 2026-11-08.
2. **Relabel the admin vocabulary together with the form rename.** "Snack choice" in `question-fields.ts` and "No snack choice" in `admin-ui.ts` (both test-pinned) to "Treat choice"/"No treat choice", in the same change that updates the fixtures. Small; its own work-log entry. Do it after the form is edited so the label matches the Zeffy text the admin is mapping.
3. **Decide the alternative treat.** `TREAT_ALTERNATIVE` is generic ("a wrapped store-bought treat"). Howard or the chair should confirm it before 2026-11-08; the change is one constant, and the form choice text must match it.
4. **Record the Phase 4 deviation.** Add the "No care note from the family." empty state to the Phase 4 deviations list (documentation only).
5. **Worth a look, not blocking:** whether the pickup card should say the cookie itself, e.g. "Cookie from Mrs. Claus" in the default case, so the volunteer is not reading a raw Zeffy answer. Today it shows whatever string the family chose. Decide after seeing real answers.

### Outputs
- This section in `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-31-santas-workshop-cookie-copy.md`. No code edited, nothing committed or pushed.

### Open questions / handoff notes
- Orchestrator: this is safe to include in the next push; the gating item is the user's Zeffy edit, not the code.
- Each follow-up above gets its own work-log entry or a backlog line (follow-up 1 is a user task, not a build).

## 2026-11-04 follow-up: snack question dropped from the form

**Decision (user, 2026-11-04):** the Zeffy sign-up form no longer asks a snack/treat question. Every stuffy comes home with an iced sugar cookie from Mrs. Claus; a family whose child cannot have it says so at pickup. v1.100.1 copy ("choose ... on the sign-up form") was therefore wrong. This supersedes follow-ups 1-3 above (form edit, relabel, alternative treat) except the user's own Zeffy form edit.

**Phases:** 1-3 skipped by the orchestrator (copy plus one required flag; no schema, API or permission change). Phase 5 reduced to unit tests plus gates at the user's request; no e2e run.

### Changes
- `src/components/santas-workshop/copy.ts`: `TREAT` rewritten, `TREAT_ALTERNATIVE` removed (no other users); `PRIVACY_ASKED` and `PRIVACY_USE` drop the treat choice.
- `src/app/privacy/page.tsx`: same two removals.
- `src/lib/santas-workshop/question-fields.ts`: `snack` is `required: false` (field, DB column, mapper and admin label kept so a session that still maps a snack question keeps working).
- `src/lib/santas-workshop/payment-mapper.ts`: no longer raises `missing_snack`. The code stays in the `AttentionCode` vocabulary and the admin label so existing flagged rows still render.
- `src/components/santas-workshop/crew/pickup-panel.tsx`: the Treat block renders only when a choice exists.
- Tests: `copy.test.ts` (new sentence pinned, no-allergen assertions kept), `payment-mapper.test.ts`, `payment-apply.test.ts` (reset case now triggers on a removed name), `question-fields.test.ts`, `session-checklist.test.ts`; `e2e/santas-workshop-crew-flow.spec.ts` now asserts the Treat block is absent for a stuffy with none chosen (not run).

### Gates
`pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors (1 pre-existing unused-directive warning in budget-context-panel.tsx); `pnpm test` 332 files / 5776 tests pass; `pnpm build:only` see report.

### Note
Existing rows already flagged `missing_snack` stay flagged until dismissed or remapped.
