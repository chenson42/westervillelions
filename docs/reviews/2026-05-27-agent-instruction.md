# Agent & Instruction Review — 2026-05-27

**Outcome:** 4 low-severity findings, 2 informational observations; no agent is broken, no path is dead, no feature reference is stale. All suggestions are sharpening edits.

---

## Scope

Files examined:
- `.claude/agents/` — all 9 agent files
- `.claude/skills/` — all 5 skill SKILL.md files
- `~/.claude/settings.json` (user-level; no project-level settings.json exists)
- `docs/work-log/` — all 10 entries (to verify actual agent usage vs. definitions)
- Cross-check of "Agent Roster" table and "Development Pipeline" in `CLAUDE.md` against agent files

---

## Findings

### Finding 1 — `database-admin` and `api-developer` have never appeared as Phase 4 owners in any completed work-log
**Location:** `docs/work-log/*.md` (all entries), `CLAUDE.md` → Agent Roster, both agent files  
**Observation:** Across all 10 work-log entries, `database-admin` and `api-developer` have zero Phase 4 ownership rows. All substantive implementation has gone to `full-stack-developer` (9 times) or `ux-developer` (2 times). The pipeline table in `CLAUDE.md` lists four Phase 4 implementers, and the "Implementer selection" table says to use `database-admin` for "schema only" and `api-developer` for "route handlers, server actions, server logic."  
**Risk:** Low. The full-stack-developer agent correctly references the `api-developer` and `ux-developer` patterns. The split-agent path is documented but unused; there is no inconsistency in what the agents say, only a gap between the description and practice.  
**Suggested correction:** Add a note to the `database-admin` and `api-developer` descriptions acknowledging that for small-to-medium features `full-stack-developer` is the common path, and that the specialist split is reserved for large or highly decoupled work. This sets accurate expectations for any future contributor reading the files.

---

### Finding 2 — `deployment-engineer` has never appeared as an owner in any work-log; the pre-deploy phase is absorbed into `pre-push`
**Location:** `docs/work-log/*.md`, `deployment-engineer.md`, `.claude/skills/pre-push/SKILL.md`  
**Observation:** `deployment-engineer` owns "pre-deploy" in CLAUDE.md's pipeline description, but no work-log entry has a "Pre-Deploy" section authored by this agent. Instead, the `/pre-push` skill covers the same checklist (typecheck, build, migration idempotency, release notes, housekeeping). In practice the user runs `/pre-push` rather than spawning the deployment-engineer agent for every merge.  
**Risk:** Low. The agent itself is accurate and useful for diagnosing build failures and Vercel issues. But the pipeline table in `CLAUDE.md` lists the deployment-engineer under "Pre-deploy" as if it is a mandatory pipeline phase, which it is not in actual practice — `/pre-push` fills that slot.  
**Suggested correction:** Update `CLAUDE.md`'s pipeline description to clarify that "pre-deploy" is covered by `/pre-push` and that `deployment-engineer` is invoked reactively (build failures, env-var changes, Vercel diagnostics) rather than as a mandatory pipeline gate. No change needed to `deployment-engineer.md` itself.

---

### Finding 3 — `add-permission` skill Step 6 references a `CLAUDE.md` feature/permission inventory that does not exist
**Location:** `.claude/skills/add-permission/SKILL.md`, line: "If `CLAUDE.md` maintains a feature/permission inventory, add the new row."  
**Observation:** `CLAUDE.md` has no "Feature/Permission inventory" section. The hedging "if" makes this harmless in practice (the condition is always false), but it points to a section that was either never created or was removed. It also asks the skill to run `/release-notes` as a final step, which is the correct behavior but redundant when the skill is run as part of a pipeline that already ends in `/release-notes`.  
**Risk:** Low. No action will be taken on the false condition. No feature is broken.  
**Suggested correction:** Remove the first sentence of Step 6 ("If `CLAUDE.md` maintains a feature/permission inventory, add the new row."). The `/release-notes` call at the end of Step 6 is fine and should stay.

---

### Finding 4 — `tech-lead.md` lists its own ownership of the 30-day documentation review, but the system prompt in the active session loads `tech-lead.md` directly as the agent definition — creating a self-referential check
**Location:** `tech-lead.md` → Ownership section; `CLAUDE.md` → Periodic Reviews table  
**Observation:** This is the review being conducted right now. The Ownership section of `tech-lead.md` says "30-day documentation review — Monthly audit of `CLAUDE.md`, agent files, skill docs, and `docs/` for drift…" and separately "30-day agent & instruction review — Monthly review of `.claude/agents/`, `.claude/skills/`, and `.claude/settings.json` for stale guidance…" Both of these are tech-lead responsibilities. This is self-consistent but the two reviews overlap substantially in scope (both audit agent files and `CLAUDE.md`). Running them as separate passes on the same day is redundant.  
**Risk:** Informational only. No content is wrong.  
**Suggested correction:** Consider merging the documentation review and agent-instruction review into a single "30-day instruction layer review" to avoid running two overlapping passes. If kept separate, add a note to each that the other should be run in the same session.

---

## Informational Observations (not actionable, no correction needed)

### Observation A — `rounded-full` on admin status badges is a known pre-existing drift
**Location:** `ux-developer.md`, `tech-lead.md` (code review checklist), `CLAUDE.md` → UX Guidelines  
**Status:** The plastic-dropoff Phase 6 review explicitly called out that `rounded-full` on status badges in `locations-manager.tsx` is inherited from the reference implementation and is pre-existing drift. The agent files correctly say "no `rounded-full` outside of avatars/badges." The badge carve-out is already in the rule wording. No change needed.

### Observation B — No project-level `.claude/settings.json` exists; only user-level `~/.claude/settings.json`
**Location:** `~/.claude/settings.json`  
**Content:** `enabledPlugins`, `skipDangerousModePermissionPrompt`, `theme`, `agentPushNotifEnabled`, `inputNeededNotifEnabled`. These are all legitimate user preferences, none are project-specific. `skipDangerousModePermissionPrompt: true` means the user has opted into fewer permission prompts globally. There are no MCP server entries that could be stale, and no permission allowlist entries to flag. The `frontend-design@claude-plugins-official` plugin is enabled — the corresponding skill (`frontend-design:frontend-design`) is present in the system-reminder. Nothing stale.

---

## Checked and Clean

| Bucket | Verdict |
|--------|---------|
| `analyst.md` | Accurate. Five-pass structure, Phase 1 and Phase 6 bodies, handoff template — all consistent with CLAUDE.md pipeline. |
| `architect.md` | Accurate. Directory structure rules match actual `src/` layout. Dependency evaluation criteria reference all packages in use. |
| `tech-lead.md` | Accurate. Design doc template, code review checklist, `hasFeature()` references all match current codebase. |
| `database-admin.md` | Accurate. Schema patterns, migration patterns, and idempotency examples all match `drizzle/migrations/` conventions in use. |
| `api-developer.md` | Accurate. Route handler pattern, error codes, `sendEmail()` usage all match current codebase conventions. |
| `ux-developer.md` | Accurate. Component patterns, brand color rules, ConfirmDialog usage — all consistent with `CLAUDE.md` UX Guidelines. |
| `full-stack-developer.md` | Accurate. Correctly cross-references api-developer and ux-developer patterns. The 150-line threshold for specialist split is reasonable and matches actual usage. |
| `qa.md` | Accurate. `vitest.config.ts` and `playwright.config.ts` both exist. Coverage targets and test naming conventions reflect current test suite. |
| `deployment-engineer.md` | Accurate for its reactive role. Build commands, env-var table, and idempotency failure patterns are all correct. The reactive vs. mandatory-gate question is covered in Finding 2 above. |
| `neon-postgres` skill | Accurate. `DATABASE_URL` pooling guidance, branching workflow, and Drizzle Kit command names all match the project. |
| `new-feature` skill | Accurate. Pipeline phase table matches CLAUDE.md exactly. |
| `release-notes` skill | Accurate. Template structure, versioning rules, and the "no file lists" invariant all match the actual release notes in `docs/release-notes/`. |
| `pre-push` skill | Accurate. All 10 steps match the project's build commands and migration conventions. |
| Agent Roster table in CLAUDE.md | Consistent with agent file descriptions and pipeline phase ownership. |
| Pipeline phases in CLAUDE.md vs. agent files | Consistent. Phase numbers, owner names, gate descriptions, and loop-back rules all agree between CLAUDE.md and the individual agent files. |
