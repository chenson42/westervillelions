"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { CrewScenesResponse, CrewScene } from "@/lib/santas-workshop/crew-contract";
import { crewFetch, crewPaths } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN, CREW_BTN_SMALL, CREW_CARD } from "./crew-styles";
import { PhotoCapture } from "./photo-capture";
import { queuePhoto } from "./photo-queue";
import { SCENE_PICK_FIRST, SCENES_FAILED, SCENES_LOADING, ScenePicker } from "./scene-picker";
import { clearSceneStore, OTHER_CHOICE, readCachedScenes, readSceneChoice, writeCachedScenes, writeSceneChoice } from "./scene-store";

/** Group photos belong to the session, not to a stuffy: no scan, no name. */
export function GroupPanel({ ctx }: { ctx: CrewCtx }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  // Remounting the capture control clears its preview after each photo.
  const [round, setRound] = useState(0);
  // The storyline: null until known (cache or server). A failed load with no cache leaves it null.
  const [scenes, setScenes] = useState<CrewScene[] | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "failed">("loading");
  const [choice, setChoice] = useState<string | null>(null);
  const { slug, failureText } = ctx;

  const loadScenes = useCallback(async () => {
    setLoadState("loading");
    const res = await crewFetch<CrewScenesResponse>(crewPaths(slug).scenes);
    if (res.ok) {
      const fresh = res.data.scenes;
      writeCachedScenes(slug, fresh);
      setScenes(fresh);
      setLoadState("ok");
      // A remembered scene that no longer exists is forgotten; the picker asks again.
      setChoice((c) => {
        if (c === null || c === OTHER_CHOICE || fresh.some((s) => s.id === c)) return c;
        writeSceneChoice(slug, null);
        return null;
      });
      return;
    }
    if (res.body?.code === "crew_auth_required") {
      clearSceneStore(slug);
      setScenes(null);
      setChoice(null);
      failureText(res, "view");
      return;
    }
    setLoadState("failed");
  }, [slug, failureText]);

  // Show the cached list and the sticky choice at once, then refresh from the server.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const cached = readCachedScenes(slug);
      if (cached) setScenes(cached);
      setChoice(readSceneChoice(slug));
      void loadScenes();
    }, 0);
    return () => window.clearTimeout(t);
  }, [slug, loadScenes]);

  function choose(value: string) {
    setChoice(value);
    writeSceneChoice(slug, value);
  }

  const hasScenes = scenes !== null && scenes.length > 0;
  const activeScene = hasScenes && choice !== null && choice !== OTHER_CHOICE ? (scenes.find((s) => s.id === choice) ?? null) : null;
  const pickedOk = choice === OTHER_CHOICE || activeScene !== null;
  let disabledReason: string | undefined;
  if (scenes === null && loadState === "loading") disabledReason = SCENES_LOADING;
  else if (hasScenes && !pickedOk) disabledReason = SCENE_PICK_FIRST;

  async function use(file: File) {
    setBusy(true);
    setMessage(null);
    const sceneId = activeScene?.id ?? null;
    const res = await queuePhoto(ctx, {
      file,
      kind: "group",
      stuffyId: null,
      // The label stays on this phone (the outbox list); only the id travels in the upload's meta.
      label: activeScene ? `Group photo: ${activeScene.title}` : "Group photo",
      build: (p) => ({ photoId: p.photoId, takenAt: p.takenAt, width: p.width, height: p.height, thumbWidth: p.thumbWidth, thumbHeight: p.thumbHeight, sceneId }),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    setSaved((n) => n + 1);
    setRound((r) => r + 1);
    toast.success("Group photo saved on this phone. Sending…");
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <h2 className="text-2xl font-bold text-gray-900">Group photo</h2>
      <div className={`${CREW_CARD} space-y-4 p-4`}>
        {hasScenes && scenes && <ScenePicker scenes={scenes} choice={pickedOk ? choice : null} onChoose={choose} />}
        {scenes === null && loadState === "failed" && (
          <div role="status" className="space-y-2 rounded-2xl bg-amber-50 p-3 text-amber-900">
            <p>{SCENES_FAILED}</p>
            <button type="button" className={CREW_BTN_SMALL} onClick={() => void loadScenes()}>
              Try again
            </button>
          </div>
        )}
        <PhotoCapture
          key={round}
          stuffyLabel="the group"
          prompt="Take a photo of the stuffies together with Santa and Mrs. Claus. No children in frame."
          takeLabel="Take group photo"
          busy={busy}
          disabledReason={disabledReason}
          pill={activeScene ? `For: ${activeScene.title}` : undefined}
          onUse={(f) => void use(f)}
        />
      </div>
      {saved > 0 && (
        <p role="status" className="rounded-2xl bg-green-50 p-3 text-green-900">
          {saved} group photo{saved === 1 ? "" : "s"} saved on this phone. Take another, or go back to the list.
        </p>
      )}
      {message && (
        <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-amber-900">
          {message}
        </p>
      )}
      <button type="button" className={CREW_BTN} onClick={() => ctx.navigate({ name: "list" })}>
        Back to the list
      </button>
    </div>
  );
}
