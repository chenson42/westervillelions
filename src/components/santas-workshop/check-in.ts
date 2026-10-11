// Pure roster helpers for the conductor screen. In-memory only; never mutates input.

export interface RosterRow {
  tag: string;
  name: string;
  kind: string;
  boarded: boolean;
}

export function filterRoster<T extends RosterRow>(roster: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...roster];
  return roster.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.kind.toLowerCase().includes(q) ||
      r.tag.toLowerCase().includes(q),
  );
}

export function toggleBoarded<T extends RosterRow>(roster: readonly T[], tag: string): T[] {
  return roster.map((r) => (r.tag === tag ? { ...r, boarded: !r.boarded } : r));
}

export function countBoarded(roster: readonly RosterRow[]): number {
  return roster.filter((r) => r.boarded).length;
}
