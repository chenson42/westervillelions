import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSceneStore, OTHER_CHOICE, readCachedScenes, readSceneChoice, writeCachedScenes, writeSceneChoice } from "./scene-store";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("scene-store", () => {
  it("round-trips the choice and the cached list", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const scenes = [{ id: "a", title: "The Sleigh Arrives", caption: null }, { id: "b", title: "Cocoa", caption: "Warm" }];
    writeSceneChoice("s1", "a");
    writeCachedScenes("s1", scenes);
    expect(readSceneChoice("s1")).toBe("a");
    expect(readCachedScenes("s1")).toEqual(scenes);
    writeSceneChoice("s1", OTHER_CHOICE);
    expect(readSceneChoice("s1")).toBe("other");
  });

  it("keys are per session slug", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    writeSceneChoice("s1", "a");
    expect(readSceneChoice("s2")).toBeNull();
    expect(readCachedScenes("s2")).toBeNull();
  });

  it("clear removes both the choice and the list", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    writeSceneChoice("s1", "a");
    writeCachedScenes("s1", [{ id: "a", title: "T", caption: null }]);
    clearSceneStore("s1");
    expect(readSceneChoice("s1")).toBeNull();
    expect(readCachedScenes("s1")).toBeNull();
  });

  it("a throwing localStorage accessor never throws out of the store", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => writeSceneChoice("s1", "a")).not.toThrow();
      expect(() => writeCachedScenes("s1", [])).not.toThrow();
      expect(() => clearSceneStore("s1")).not.toThrow();
      expect(readSceneChoice("s1")).toBeNull();
      expect(readCachedScenes("s1")).toBeNull();
    } finally {
      // @ts-expect-error restoring the test environment
      delete globalThis.localStorage;
    }
  });

  it("a corrupt cached list reads as no cache", () => {
    const st = memoryStorage();
    vi.stubGlobal("localStorage", st);
    st.setItem("sw-crew-scene-list:s1", "{not json");
    expect(readCachedScenes("s1")).toBeNull();
    st.setItem("sw-crew-scene-list:s1", JSON.stringify([{ id: 1 }]));
    expect(readCachedScenes("s1")).toBeNull();
  });
});
