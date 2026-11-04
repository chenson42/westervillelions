/** Source scans for the group panel's scene handling (DECISION-128, Phase 3 test 11). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const panel = read("group-panel.tsx");

describe("group panel scenes", () => {
  it("builds sceneId into the upload meta", () => {
    expect(panel).toMatch(/build: \(p\) => \(\{[^}]*sceneId \}\)/);
  });
  it("keeps the outbox label local: it names the scene but never enters the meta or the multipart body", () => {
    expect(panel).toContain("`Group photo: ${activeScene.title}`");
    const build = panel.slice(panel.indexOf("build:"), panel.indexOf("build:") + 260);
    expect(build).not.toContain("label");
    expect(read("outbox-send.ts")).not.toMatch(/\.label|label:/);
    expect(read("outbox-send.ts")).toContain("JSON.stringify(item.meta)");
  });
  it("with scenes and no choice both capture buttons are disabled with 'Pick a scene first.'", () => {
    expect(read("scene-picker.tsx")).toContain('SCENE_PICK_FIRST = "Pick a scene first."');
    expect(panel).toContain("disabledReason = SCENE_PICK_FIRST");
    const capture = read("photo-capture.tsx");
    expect(capture).toContain("const disabled = disabledProp || !!disabledReason");
    // Both inputs and both labels read the same `disabled`.
    expect(capture.match(/disabled=\{disabled \|\| busy\}/g)?.length).toBe(2);
    expect(capture).toContain("Choose a saved photo");
    expect(capture).toContain("{takeLabel}");
  });
  it("zero scenes renders today's controls: the picker only shows when there are scenes", () => {
    expect(panel).toContain("{hasScenes && scenes && <ScenePicker");
    expect(panel).toContain("const hasScenes = scenes !== null && scenes.length > 0");
  });
  it("a failed fetch with no cache enables capture and shows the 'Scenes didn't load' sentence; a cached list still renders", () => {
    expect(read("scene-picker.tsx")).toContain("Scenes didn't load. You can still take the photo; an admin will put it in a scene.");
    expect(panel).toContain('scenes === null && loadState === "failed"');
    // The disabled reason is only the loading sentence while nothing is known yet.
    expect(panel).toContain('if (scenes === null && loadState === "loading") disabledReason = SCENES_LOADING');
    expect(panel).toContain("readCachedScenes(slug)");
    expect(panel).toContain("if (cached) setScenes(cached)");
  });
  it("forgets a stale sticky id after a fresh load and clears the store on crew_auth_required", () => {
    expect(panel).toContain("fresh.some((s) => s.id === c)");
    expect(panel).toMatch(/crew_auth_required[\s\S]{0,80}clearSceneStore\(slug\)/);
    const app = read("crew-app.tsx");
    expect(app).toContain("clearSceneStore(slug)");
    expect(app).toContain("Boolean(showCodeScreen)");
  });
  it("shows the 'For: <scene>' pill on the preview", () => {
    expect(panel).toContain("pill={activeScene ? `For: ${activeScene.title}` : undefined}");
    expect(read("photo-capture.tsx")).toContain("{pill && ");
  });
  it("reads scenes from the dedicated crew route, never the roster", () => {
    expect(read("crew-api.ts")).toContain("scenes: `${base}/scenes`");
  });
});
