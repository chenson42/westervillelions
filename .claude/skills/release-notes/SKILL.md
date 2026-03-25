---
name: release-notes
description: Write or update release notes for a code change and bump the version in package.json
---

# Release Notes

When the user invokes `/release-notes`, write a release notes entry for the current change and bump the version.

---

## Versioning Strategy

Semantic versioning: **MAJOR.MINOR.PATCH**

| Segment | When to increment |
|---------|-------------------|
| **MAJOR** | Significant new functionality, breaking changes, or major milestones |
| **MINOR** | New features, enhancements, non-breaking changes |
| **PATCH** | Bug fixes, minor adjustments |

---

## File Structure

Release notes live in `docs/release-notes/`. Each minor version has its own file:

```
docs/release-notes/
├── v1.2.md   ← current
├── v1.1.md   ← previous
└── v1.0.md
```

If `docs/release-notes/` doesn't exist yet, create it.

---

## Step 1: Determine the Version Number

1. Read `package.json` to get the current version
2. Check `docs/release-notes/` for the most recent version file
3. Determine the next version:
   - Bug fix / small change → increment PATCH
   - New feature / enhancement → increment MINOR
   - Breaking change or major milestone → increment MAJOR
4. Ask the user to confirm if unclear

---

## Step 2: Create a New File if Needed

If incrementing the MINOR version, create a new file (e.g. `docs/release-notes/v1.3.md`):

```markdown
# Release Notes — v1.3

← [v1.2](v1.2.md)

---

## Table of Contents

| Version | Date | Type | Description |
|---------|------|------|-------------|

---
```

---

## Step 3: Write the Release Notes Entry

Add the entry to the current minor version file, newest first.

Add a row to the **Table of Contents**:
```
| [X.Y.Z](#xyz) | YYYY-MM-DD | [Type] | [One-line description] |
```

Types: `Feature`, `Enhancement`, `Defect Fix`, `Security`, `Infrastructure`

Then add the full entry:

### Feature
```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Feature: [Feature Name]

**Value:** [Why this was built]

#### What's New
- Bullet describing change

#### Files Added
- `path/to/file` — Description

#### Files Modified
- `path/to/file` — Description
```

### Enhancement
```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Enhancement: [Brief Description]

**Value:** [Why this improvement matters]

**Changes:**
- Change 1

**Files Modified:**
- `path/to/file` — Description
```

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
```

---

## Step 4: Bump the Version

Update `package.json` version to match the new version number.

**Only bump when preparing to merge into main.** If work is still in progress on a feature branch, skip this step.

**Documentation-only changes do not get a version bump.**
