# Documentation Review — 2026-06-27

**Type:** 30-day documentation review
**Owner:** tech-lead
**Last review:** 2026-05-27 (31 days — cadence met)
**Scope:** CLAUDE.md, docs/decisions.md, docs/release-notes/ chain, docs/features/the-ledger-accounting.md, docs/reviews/log.md

Since the last review (2026-05-27) the following major work shipped:
- v1.18.6–v1.18.7 (security + defect hardening)
- v1.19 (dues tracking)
- v1.20–v1.25 (The Ledger, 6 increments)
- DECISION-012 through DECISION-026 (15 new decisions)

---

## Findings

### HIGH (0)

None.

---

### MEDIUM (2)

#### MEDIUM-1: `CLAUDE.md` — Project Structure tree missing `ledger`, `dues`, and `reimbursements` surfaces

**Location:** CLAUDE.md → Project Structure → `(dashboard)/admin/` line and `members/` subtree

**Finding:**

The `(dashboard)/admin/` line reads:
```
Admin functions (users, roles, members, events, groups, campaigns, announcements, programs,
membership, subscriptions, suggestions, testimonials, email-queue, sync-log, release-notes, contact)
```

The ledger surface (`/admin/ledger`) and the dues surface (`/admin/dues`) are both real, shipped, non-trivial admin areas and are absent from this list. The ledger surface has 8 sub-routes (`[fundSlug]`, `approvals`, `compliance`, `donors`, `reimbursements`, `reports`, `settings`) and is the largest admin feature shipped to date.

The `members/` subtree also omits two routes that exist on disk:
- `members/reimbursements` (ships in Ledger inc2 — members submit expense reimbursements)
- `members/dues` is NOT built yet (DECISION-012 reserved the path but did not build it)

The existing `members/impact` entry is correctly documented.

**Fix:** Expand the `(dashboard)/admin/` parenthetical to include `ledger` and `dues`. Add `members/reimbursements` to the members subtree. The `members/dues` reservation should be noted as "(reserved, not yet built)" or simply omitted.

---

#### MEDIUM-2: `CLAUDE.md` — Key Features "Admin" bullet does not mention dues or The Ledger

**Location:** CLAUDE.md → Key Features → Member Portal → Admin

**Finding:**

The Admin bullet lists:
> Member management, content updates, role/permission management, Google Group sync, campaigns,
> announcements, programs, users, membership applications, subscriptions, suggestions, testimonials,
> email-queue inspection, sync-log audit, in-app release notes, and contact submissions

Dues tracking (`/admin/dues`) and The Ledger (`/admin/ledger`) are absent. Given that The Ledger is the largest feature shipped since the last documentation review, this is a meaningful omission — any agent reading Key Features to understand what the admin portal covers will not know the financial surfaces exist.

**Fix:** Append "annual dues tracking, and ledger/accounting" to the Admin bullet.

---

### LOW (4)

#### LOW-1: `CLAUDE.md` — Project Structure `members/` subtree entry for `impact` note is slightly stale

**Location:** CLAUDE.md → Project Structure → `members/impact` line

**Finding:**

The line reads:
```
└── impact/        # Philanthropy / community impact dashboard (impact.view gated)
```

This is mostly correct but the gate description is incomplete: the dashboard is gated on `impact.view` only when `philanthropyVisibility = 'board'`. When a Ledger admin flips the setting to `'members'`, any signed-in member can view it without `impact.view`. A reader using this as documentation would think the gate is unconditional.

**Fix:** Amend the comment to: `# Philanthropy / community impact dashboard (impact.view when board-only; open to all members when visibility = 'members')`.

---

#### LOW-2: `CLAUDE.md` — `BLOB_READ_WRITE_TOKEN` prose references DECISION-018/020 but only DECISION-020 accurately describes the shipped design

**Location:** CLAUDE.md → Database Schema Patterns → Environment Variables → `BLOB_READ_WRITE_TOKEN`

**Finding:**

The entry reads:
> Required in production or receipts fall back to the ephemeral local filesystem and are lost on redeploy.
> Absent locally → zero-config `LocalReceiptStorage` adapter (`.receipt-store/`). See DECISION-018/020.

DECISION-018 is the original design (blob URL stored in `receipt_url` column, redirect-based proxy). DECISION-020 superseded it (opaque key stored in `receipt_storage_key`, streaming proxy, `LocalReceiptStorage` adapter for local dev). The design described in the CLAUDE.md text matches DECISION-020 correctly, but citing both decisions implies they are equally authoritative. A reader following DECISION-018 would implement the wrong design.

**Fix:** Change the cross-reference to "See DECISION-020 (supersedes DECISION-018)." Alternatively, drop the DECISION-018 cite and keep only DECISION-020.

---

#### LOW-3: `docs/release-notes/v1.25.md` — no forward nav link (minor, by convention)

**Location:** docs/release-notes/v1.25.md, line 3

**Finding:**

Every other release notes file in the chain has both a backward link (`← [vX.prev]`) and a forward link (`→ [vX.next]`) when a next version exists — the forward link is added retroactively when the next file is written. v1.25.md currently has only `← [v1.24](v1.24.md)` with no forward link. This is not a defect (it is the latest version), but by convention the forward link gets added when v1.26 ships.

**Fix:** No action needed now. When v1.26 ships, add `→ [v1.26](v1.26.md)` at the bottom of v1.25.md (standard practice).

---

#### LOW-4: `docs/features/the-ledger-accounting.md` — spec is pre-implementation and materially diverges from what shipped in several details

**Location:** docs/features/the-ledger-accounting.md

**Finding:**

This file was written before any implementation and was the input to the 6-phase pipeline increment by increment. Several spec details diverge from the shipped implementation:

- **§3 Permissions:** The spec lists `LEDGER_APPROVE` as bound to `admin, board_member`. The shipped `impact.view` key (`IMPACT_VIEW`) is listed in the spec under the same section but shipped separately via the `add-permission` skill. The spec does not document `DUES_VIEW` / `DUES_MANAGE` (dues permissions came before The Ledger, but they are prerequisites for the dues→ledger sync shipped in inc6a).
- **§4.5 `ledger_transactions`:** The spec shows `flow = 'income' | 'expense' | 'transfer'` but DECISION-017 dropped `'transfer'` as a valid `flow` value — only `'income'` and `'expense'` are stored; `transferGroupId` is the discriminator. The spec also shows `transferFromFundId` as a column, which DECISION-016 explicitly dropped.
- **§4.7 `ledger_filings`:** The spec shows `dueDate date` as a column, but DECISION-021 replaced it with `dueMonth integer` + `dueDay integer`. The spec also omits the `next_due_year integer` column added by DECISION-022.
- **§5 `isGiving()`:** The spec says category keywords (donation/grant/scholarship/vision/relief/screening) are part of the definition. DECISION-024 dropped the keyword check and uses only fund-kind + flow + transfer-check.
- **§4.5 `receipt_url` column:** The spec shows `receiptUrl text` on `ledger_transactions`. DECISION-020 renamed it to `receipt_storage_key text` and changed the storage model.

**Severity:** Low. This is a known historical artifact — the file has `Status: Pre-pipeline implementation spec` in the header. The decisions log accurately captures all divergences. The spec is not actively used as a source of truth for implementation decisions.

**Fix:** Add a note at the top of the file under the existing `Status:` line:
```
> **Note:** Several implementation-level details in this spec were superseded by decisions made
> during the build. See docs/decisions.md DECISIONs 016–026 for the authoritative implementation
> record. This spec is historical.
```

---

## Chains / Integrity Checks

### decisions.md numbering

DECISIONs 001–026 are all present, contiguous, and well-formed. No gaps. The format template (`DECISION-NNN`) at the bottom is a sentinel, not a numbered entry — correct.

### Release notes nav chain (v1.18 → v1.25)

All eight files checked:

| File | Back link | Forward link | Status |
|------|-----------|--------------|--------|
| v1.18 | ← v1.17 | → v1.19 | OK |
| v1.19 | ← v1.18 | → v1.20 | OK |
| v1.20 | ← v1.19 | → v1.21 | OK |
| v1.21 | ← v1.20 | → v1.22 | OK |
| v1.22 | ← v1.21 | → v1.23 | OK |
| v1.23 | ← v1.22 | → v1.24 | OK |
| v1.24 | ← v1.23 | → v1.25 | OK |
| v1.25 | ← v1.24 | (none — latest) | OK |

Chain is intact.

### package.json version

`"version": "1.25.0"` — matches the latest release notes file (v1.25.md, entry 1.25.0). Consistent.

### docs/reviews/log.md

Entries are well-formed. All use the `YYYY-MM-DD | type | one-line outcome` format. Newest-first ordering is maintained. No malformed lines detected.

---

## Recommended Fixes (priority order)

1. **MEDIUM-1 — Project Structure tree (CLAUDE.md):** Add `ledger` and `dues` to the admin parenthetical; add `members/reimbursements` to the members subtree.
2. **MEDIUM-2 — Key Features Admin bullet (CLAUDE.md):** Append "annual dues tracking, and ledger/accounting."
3. **LOW-1 — `members/impact` gate comment (CLAUDE.md):** Clarify the two-tier gate in the inline comment.
4. **LOW-2 — `BLOB_READ_WRITE_TOKEN` decision cite (CLAUDE.md):** Change "DECISION-018/020" to "DECISION-020 (supersedes DECISION-018)."
5. **LOW-4 — Ledger spec historical note (docs/features/the-ledger-accounting.md):** Add a "this spec is historical" note under the Status line.
6. **LOW-3 — v1.25 forward nav (docs/release-notes/v1.25.md):** No action now; add `→ [v1.26]` when that file is written.

All fixes are editorial (no code, no schema). A single commit can batch all five active changes.
