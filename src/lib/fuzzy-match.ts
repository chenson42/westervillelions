// Tiny dependency-free fuzzy matcher for the admin sidebar's type-to-filter
// search (docs/work-log/2026-09-04-admin-nav-search.md). Subsequence matching
// with position-aware scoring: prefix matches beat mid-word matches, word-start
// matches beat mid-word matches, contiguous runs beat scattered letters. Match
// positions are returned so the UI can highlight the matched label characters.
//
// Deliberately NOT a general-purpose search library — targets here are short
// nav labels/keywords (< ~30 chars) and queries are a handful of characters,
// so the O(targets × positions) scan is trivially cheap per keystroke.

export interface FuzzyMatchResult {
  /** Higher is better. Only comparable between matches for the same query. */
  score: number;
  /** Indices into the ORIGINAL target string of each matched character. */
  positions: number[];
}

const CONTIGUOUS_BONUS = 5;
const WORD_START_BONUS = 10;
const PREFIX_BONUS = 15;
const MAX_GAP_PENALTY = 3;

function isWordStart(target: string, index: number): boolean {
  if (index === 0) return true;
  const prev = target[index - 1];
  return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === "'";
}

function greedyMatchFrom(query: string, target: string, start: number): FuzzyMatchResult | null {
  const positions: number[] = [];
  let score = 0;
  let ti = start;
  let prevMatch = -1;

  for (let qi = 0; qi < query.length; qi++) {
    while (ti < target.length && target[ti] !== query[qi]) ti++;
    if (ti >= target.length) return null;

    score += 1;
    if (ti === 0) score += PREFIX_BONUS;
    if (isWordStart(target, ti)) score += WORD_START_BONUS;
    if (prevMatch !== -1) {
      if (ti === prevMatch + 1) {
        score += CONTIGUOUS_BONUS;
      } else {
        score -= Math.min(ti - prevMatch - 1, MAX_GAP_PENALTY);
      }
    }

    positions.push(ti);
    prevMatch = ti;
    ti++;
  }

  return { score, positions };
}

/**
 * Case-insensitive fuzzy subsequence match of `query` against `target`.
 * Returns the best-scoring alignment (trying each occurrence of the query's
 * first character as a starting point), or null when the query is not a
 * subsequence of the target. An empty/whitespace-only query returns null —
 * callers treat "no query" as "no filtering", not "match everything".
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const t = target.toLowerCase();
  if (q.length > t.length) return null;

  let best: FuzzyMatchResult | null = null;
  for (let start = 0; start <= t.length - q.length; start++) {
    if (t[start] !== q[0]) continue;
    const result = greedyMatchFrom(q, t, start);
    if (result && (best === null || result.score > best.score)) best = result;
  }
  return best;
}

// ── Nav-entry matching (label > keywords > group) ───────────────────────────

export interface NavSearchEntry {
  label: string;
  group?: string | null;
  keywords?: string[];
}

export interface NavEntryMatch {
  score: number;
  /**
   * Positions into `label` for highlighting — non-null only when the label
   * itself matched. A keyword/group-only match has nothing visible to
   * highlight, so it returns null and the UI renders the label plain.
   */
  labelPositions: number[] | null;
}

// Source-priority offsets keep any label match ranked above any keyword
// match, and any keyword match above any group match, regardless of the raw
// alignment scores (a nav label is what the user sees, so matching it is
// always the stronger signal).
const LABEL_SOURCE_BONUS = 200;
const KEYWORD_SOURCE_BONUS = 100;

/**
 * Match a query against a nav entry's label, keywords, and group header.
 * Label matches always outrank keyword matches, which always outrank group
 * matches. Returns null when nothing matches.
 */
export function matchNavEntry(query: string, entry: NavSearchEntry): NavEntryMatch | null {
  const labelResult = fuzzyMatch(query, entry.label);
  if (labelResult) {
    return { score: labelResult.score + LABEL_SOURCE_BONUS, labelPositions: labelResult.positions };
  }

  let bestKeyword: FuzzyMatchResult | null = null;
  for (const keyword of entry.keywords ?? []) {
    const result = fuzzyMatch(query, keyword);
    if (result && (bestKeyword === null || result.score > bestKeyword.score)) bestKeyword = result;
  }
  if (bestKeyword) {
    return { score: bestKeyword.score + KEYWORD_SOURCE_BONUS, labelPositions: null };
  }

  if (entry.group) {
    const groupResult = fuzzyMatch(query, entry.group);
    if (groupResult) return { score: groupResult.score, labelPositions: null };
  }

  return null;
}
