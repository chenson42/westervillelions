/**
 * Minimal ambient types for `turndown-plugin-gfm` — it ships no `.d.ts` and
 * no `@types/turndown-plugin-gfm` package exists on the registry (checked
 * before writing this, per the libheif-js precedent at
 * src/types/libheif-js-wasm-bundle.d.ts). Covers only the surface this
 * project actually uses: the combined GFM plugin (tables, strikethrough,
 * task list items, highlighted code blocks) passed to
 * `TurndownService#use()`.
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, DECISION-074 Ruling 1 —
 * `turndown`/`turndown-plugin-gfm`, client-only.
 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  type TurndownPlugin = (turndownService: TurndownService) => void;

  export const gfm: TurndownPlugin;
  export const tables: TurndownPlugin;
  export const strikethrough: TurndownPlugin;
  export const taskListItems: TurndownPlugin;
  export const highlightedCodeBlock: TurndownPlugin;
}
