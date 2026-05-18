---
name: release-notes
description: Write or update release notes for a code change, bump the version in package.json, and create a new minor-version file when needed
---

# Release Notes

When the user invokes `/release-notes`, write a release-notes entry for the current change, bump the version in `package.json`, and ensure the file structure stays consistent.

---

## Versioning Strategy

This project uses semantic versioning: **MAJOR.MINOR.PATCH**.

| Segment | When to increment |
|---------|-------------------|
| **MAJOR** | Significant new functionality, breaking changes, or major milestones. |
| **MINOR** | New features, enhancements, non-breaking changes. |
| **PATCH** | Bug fixes, defect corrections, minor adjustments. |

`package.json` uses the natural form (e.g., `"1.11.5"`). Release-notes filenames use the major.minor form (`v1.11.md`).

---

## File Structure

Release notes live in `docs/release-notes/`. Each minor version gets its own file:

```
docs/release-notes/
├── v1.12.md   ← current
├── v1.11.md   ← previous
└── ...
```

When a new **major** version starts (e.g., `v2.x`), create the new file and link it from the previous one.

---

## Step 1: Determine the Version Number

1. Read `package.json` to get the current version.
2. Read the table of contents in the current minor-version file (e.g., `docs/release-notes/v1.12.md`) to see the most recent entry.
3. Determine the next version:
   - **Bug fix / small change** → increment PATCH (e.g., `1.12.0` → `1.12.1`).
   - **New feature / enhancement** → increment MINOR (e.g., `1.12.1` → `1.13.0`).
   - **Breaking change or major milestone** → increment MAJOR.
4. Ask the user to confirm if unclear.

---

## Step 2: Create a New Minor-Version File if Needed

If you're bumping MINOR (e.g., `1.12.x` → `1.13.0`), create the new file using the **New Minor Version File** template at the bottom of this document. Then add a nav link at the bottom of the previous file: `→ [v1.13](v1.13.md)`.

---

## Step 3: Write the Entry

Add to the current minor-version file, newest first.

1. **Add a row to the Table of Contents** at the top of the file:
   ```
   | [X.Y.Z](#xyz) | YYYY-MM-DD | [Type] | [One-line description] |
   ```

2. **Add the full entry** below the previous entry using the appropriate template (Feature, Enhancement, Defect Fix, Infrastructure, Security).

3. Use these types in the TOC:
   - `Feature` — new user-facing functionality.
   - `Enhancement` — improvement to an existing feature.
   - `Defect Fix` — bug correction.
   - `Security` — security update.
   - `Infrastructure` — internal/technical change with no direct user impact.

---

## Step 4: Update CLAUDE.md

Review `CLAUDE.md` for drift introduced by the release:

- **"Key Features"** — if the release adds a user-visible capability (a new page, a new auth flow, a new pattern), add a bullet.
- **"Project Structure"** — if the release adds a route group or top-level directory under `src/app/`, add the corresponding line to the tree.
- **"Common Commands"** — if the release adds a `pnpm` script that a developer or agent would need to invoke, add it to the command block.

If none of these apply (e.g., a pure bug fix touching only internal logic with no new routes or patterns), skip with a one-line note: "CLAUDE.md: no user-visible surface changes."

---

## Step 5: Bump the Version

**Only bump when the branch is being prepared to merge into `main`.** If work is still in progress on a feature branch, skip this step — all changes ship as a single version when the branch merges.

**Documentation-only changes do not get a version bump.** If a PR only changes docs (no code), skip Step 5 entirely.

**All code changes on a branch ship as a single version.** Combine the entries; don't create one per commit.

When ready to merge, update `package.json` `version` to match the release-notes version number.

---

## Templates

### Feature

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Feature: [Feature Name]

**Value:** [Why this was built — the problem it solves or the opportunity it captures]

#### What's New

- [User-facing change]
- [User-facing change]

#### Permissions

| Feature key | Required for |
|-------------|--------------|
| `area.action` | Description |

#### New Routes

- `GET /path` — Description
- `POST /api/...` — Description

#### Files Added
- `path/to/file` — Description

#### Files Modified
- `path/to/file` — Description
```

---

### Enhancement

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Enhancement: [Brief Description]

**Value:** [Why this improvement matters]

**Changes:**
- [Change]
- [Change]

**Files Modified:**
- `path/to/file` — Description
```

---

### Defect Fix

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Defect Fix: [Brief Description]

**Problem:** [What the user experienced]

**Root Cause:** [Why it happened]

**Fix:** [What was changed]

**Files Modified:**
- `path/to/file` — Description

**Testing:**
- [x] Manual click-through case 1
- [x] Manual click-through case 2
```

---

### Infrastructure / Security

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### [Infrastructure | Security]: [Brief Description]

**Background:** [Context for the change]

**Changes:**
- [Change]
- [Change]

**Files Modified:**
- `path/to/file` — Description
```

---

### New Minor Version File Template

```markdown
# Release Notes — vX.Y

*← [vX.(Y-1)](vX.(Y-1).md)*

---

## Table of Contents

| Version | Date | Type | Description |
|---------|------|------|-------------|
| [X.Y.0](#xy0) | YYYY-MM-DD | Feature | Description |

---

[entries go here, newest first]
```
