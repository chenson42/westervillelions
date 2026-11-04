# Family last name on the volunteer list

**Started:** 2026-11-04 · **Type:** small change (bug-fix variant) · **Status:** Phase 4 complete; Phase 5 reduced at the user's request ("quickly so I can test")

## Request
During the practice test the user noted stuffies will often share a name. Decision: identify a row by stuffy name + "what it is" (a new form question, mapped to `stuffy_description`) + the family's last name. The user first proposed the parent's email; declined because crew DTOs carry no contact data (DECISION-121, `crew-contract-no-contact.test.ts`) and the screens open on a shared code.

## Change
- `CrewRosterRow.familyLastName` (crew-contract.ts): the order's buyer last name, trimmed, null when blank. Last name only; no first name, email or phone.
- `crew-queries.ts`: roster and search select `sw_orders.buyer_last_name` into the one row mapper (`toCrewRow`).
- `roster-view.tsx`: the grey line reads `Last name · window · what it is · Tag ••1234`.
- `crew-ui.ts`: the on-phone filter also matches the last name (server search already matched it).

## Trade-off (recorded, accepted by the user's decision)
The pickup flow hides the parent's name until the volunteer presses "Show the name on the order", so the person collecting says the name first. With the last name on the list, a volunteer can read it before asking. Mitigation is procedural: volunteers ask "What's the name on the order?" before looking. The first name stays hidden until the reveal.

## Phases
- 1–3 skipped by the orchestrator (a list field; no schema, route, permission change). The least-data invariant is touched: a new non-contact field on the bulk row, user-directed.
- 4 inline by the orchestrator. `crew-queries.test.ts` pins the new key set and the blank-to-null rule.
- 5 reduced: `tsc` clean, full `pnpm test` pass, eslint clean on touched files. Not run: build, e2e, a real phone.
