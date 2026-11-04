import type { CrewScene } from "@/lib/santas-workshop/crew-contract";

/**
 * The group panel's memory of the storyline on this phone: the last scene list the server
 * sent (so the picker still works with no signal) and the volunteer's sticky choice (so a
 * run of photos for one scene is one tap each). Both live in localStorage per session slug,
 * every access in try/catch (private windows and blocked storage throw), and both are cleared
 * when the crew cookie stops working. Pure and client-safe: no React, no fetch.
 */

/** The sticky value meaning "no scene" (Other pictures). A scene is its uuid. */
export const OTHER_CHOICE = "other";

const choiceKey = (slug: string) => `sw-crew-scene-choice:${slug}`;
const listKey = (slug: string) => `sw-crew-scene-list:${slug}`;

function read(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}
function remove(key: string): void {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

export function readSceneChoice(slug: string): string | null {
  const v = read(choiceKey(slug));
  return v && v.length <= 64 ? v : null;
}
export function writeSceneChoice(slug: string, choice: string | null): void {
  if (choice === null) remove(choiceKey(slug));
  else write(choiceKey(slug), choice);
}

export function readCachedScenes(slug: string): CrewScene[] | null {
  const raw = read(listKey(slug));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: CrewScene[] = [];
    for (const s of parsed) {
      if (typeof s !== "object" || s === null) return null;
      const { id, title, caption } = s as Record<string, unknown>;
      if (typeof id !== "string" || typeof title !== "string") return null;
      out.push({ id, title, caption: typeof caption === "string" ? caption : null });
    }
    return out;
  } catch {
    return null;
  }
}
export function writeCachedScenes(slug: string, scenes: CrewScene[]): void {
  write(listKey(slug), JSON.stringify(scenes));
}

/** Forget everything for this session (the crew cookie stopped working). */
export function clearSceneStore(slug: string): void {
  remove(choiceKey(slug));
  remove(listKey(slug));
}
