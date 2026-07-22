# 2026-07-21 — overview-guardrail-links

**Status:** Complete (typecheck + production build PASS); pending user click-through
**Type:** Bug-fix variant (UI parity gap)

## Summary

The "Expenses missing receipt documentation" guardrail flag carries a `linkHref`
deep link (`/admin/ledger/all?entity=…&receipt=missing`, built in
`src/lib/ledger.ts` Check 11) that renders as "View flagged transactions →" on
the per-entity detail view (`ledger-entity-detail.tsx:180`) and the compliance
page (`compliance/page.tsx:207`) — but `AuditItemsPanel`
(`src/components/admin/ledger/audit-items-panel.tsx`), the Audit Items section
of the bare `/admin/ledger` overview dashboard, rendered title/detail/policyCite
and silently dropped `linkHref`. The data already flows there:
`getDashboard()` in `ledger-queries.ts` spreads the full flag
(`{...flag, entitySlug, entityName}`) into `EntityTaggedGuardrailFlag`.

**Root cause (one line):** the Ledger Dashboard's `AuditItemsPanel` (DECISION-031/032)
was authored before the receipt-link work (v1.31.0) added `linkHref` to
guardrail flags, and the render block was never brought to parity with the
other two flag-rendering surfaces.

**Reproduction:** with ≥1 expense missing a receipt, open `/admin/ledger`
(bare overview) — the receipt-documentation audit item shows no link; open
`/admin/ledger?entity=<slug>` or `/admin/ledger/compliance` — the same flag
shows "View flagged transactions →".

**Fix:** copy the existing `flag.linkHref &&` `<Link>` block (identical classes
and label) from `ledger-entity-detail.tsx` into `AuditItemsPanel`'s flag card,
after the policyCite line.

## Phase notation (no silent skips)

- Phase 1 (analyst): **skipped** — user-reported parity gap; intent unambiguous
  (same link, same flag, third surface).
- Phase 2 (architect): **skipped** — no invariants touched; render-only change
  in an existing component.
- Phase 3 (tech-lead): **skipped** — trivial; root cause documented above.
- Phase 4: implemented directly (8-line render block copied from the sibling
  surface; no new logic, no new tests — the linkHref value itself is already
  covered by `ledger.test.ts:757`).
- Phase 5 (qa): typecheck PASS; `pnpm build:only` PASS (exit 0).
- Phase 6 (analyst): **skipped** — covered by user confirming the link appears.

## Notes

- Review-cadence check surfaced test-coverage (26 d) and retrospective (24 d)
  as overdue; user chose **defer** for this session.
