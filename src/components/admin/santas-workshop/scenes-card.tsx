"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ADMIN_API, KIND_LABELS, callAdmin } from "@/lib/santas-workshop/admin-ui";
import type { SessionKind } from "@/lib/santas-workshop/session-vocabulary";
import {
  SCENE_CAPTION_MAX,
  SCENE_EDITOR_WARNING,
  SCENE_TITLE_MAX,
  SCENES_MAX,
  type AdminSceneDto,
  type SceneCopyRequest,
  type SceneDeleteResponse,
  type SceneOrderRequest,
  type SceneSaveRequest,
  type SceneSaveResponse,
  type ScenesListResponse,
} from "@/lib/santas-workshop/scene-contract";
import { Chip } from "./badges";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, EMPTY, INPUT, LABEL } from "./styles";

interface Props {
  sessionId: string;
  initial: AdminSceneDto[];
  /** Other sessions that have scenes (name, kind, count); the copy control shows only while this session has none. */
  copySources?: { id: string; name: string; kind: string; sceneCount: number }[];
}

type Editing = { id: string | null; title: string; caption: string };
type FieldErrors = { title?: string; caption?: string; form?: string };

function photoCountText(s: AdminSceneDto): { text: string; warn: boolean } {
  if (s.photoCount === 0) return { text: "No photos yet. It will not show on the collage until it has one.", warn: false };
  if (s.unhiddenCount === 0) return { text: `${s.photoCount} photo${s.photoCount === 1 ? "" : "s"}, all hidden. It will not show on the collage.`, warn: true };
  return { text: `${s.photoCount} photo${s.photoCount === 1 ? "" : "s"}`, warn: false };
}

/** The session's storyline: the ordered scenes that group the collage's group pictures. Scene text is PUBLIC. */
export function ScenesCard({ sessionId, initial, copySources = [] }: Props) {
  const [scenes, setScenes] = useState(initial);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminSceneDto | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);

  async function refetch() {
    const res = await callAdmin<ScenesListResponse>(ADMIN_API.scenes(sessionId));
    if (res.ok) setScenes(res.data.scenes);
  }

  function startAdd() {
    setErrors({});
    setError(null);
    setEditing({ id: null, title: "", caption: "" });
  }
  function startEdit(s: AdminSceneDto) {
    setErrors({});
    setError(null);
    setEditing({ id: s.id, title: s.title, caption: s.caption ?? "" });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErrors({});
    setError(null);
    const body: SceneSaveRequest = { title: editing.title, caption: editing.caption.trim() === "" ? null : editing.caption };
    const adding = editing.id === null;
    const res = await callAdmin<SceneSaveResponse>(adding ? ADMIN_API.scenes(sessionId) : ADMIN_API.scene(sessionId, editing.id as string), {
      method: adding ? "POST" : "PATCH",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const f = res.failure;
      if (f.code === "invalid_input" && (f.field === "title" || f.field === "caption")) setErrors({ [f.field]: f.message });
      else setErrors({ form: f.message });
      return;
    }
    setEditing(null);
    toast.success(adding ? "Scene added." : "Scene saved. The collage shows it right away.");
    await refetch();
  }

  async function move(index: number, delta: -1 | 1) {
    const next = [...scenes];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    setError(null);
    const body: SceneOrderRequest = { order: next.map((s) => s.id) };
    const res = await callAdmin<ScenesListResponse>(ADMIN_API.scenesOrder(sessionId), { method: "PUT", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      if (res.failure.code === "scenes_changed") await refetch();
      return;
    }
    setScenes(res.data.scenes);
  }

  async function remove(s: AdminSceneDto) {
    setDeleteTarget(null);
    setBusy(true);
    setError(null);
    const res = await callAdmin<SceneDeleteResponse>(ADMIN_API.scene(sessionId, s.id), { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    toast.success(res.data.movedPhotos > 0 ? `Scene deleted. ${res.data.movedPhotos} photo${res.data.movedPhotos === 1 ? "" : "s"} moved to Other pictures.` : "Scene deleted.");
    await refetch();
  }

  const copySource = copySources.find((c) => c.id === copyFrom) ?? null;

  async function copyStoryline() {
    if (!copySource) return;
    setCopyOpen(false);
    setBusy(true);
    setError(null);
    const body: SceneCopyRequest = { fromSessionId: copySource.id };
    const res = await callAdmin<ScenesListResponse>(ADMIN_API.scenesCopy(sessionId), { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      // Someone added scenes in another tab: show what is there now.
      if (res.failure.code === "scenes_not_empty") await refetch();
      return;
    }
    setScenes(res.data.scenes);
    setCopyFrom("");
    toast.success(`Copied ${res.data.scenes.length} scene${res.data.scenes.length === 1 ? "" : "s"}.`);
  }

  const atLimit = scenes.length >= SCENES_MAX;

  return (
    <section className={`${CARD} p-6`} aria-labelledby="scenes-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="scenes-heading" className="text-lg font-semibold text-gray-900">
            Storyline scenes
          </h2>
          <p className="mt-1 text-sm text-gray-600">Scenes group the collage&rsquo;s group pictures, in this order, under a title and a short caption. Crew pick a scene when they take a group photo.</p>
        </div>
        {!editing && (
          <button type="button" className={BTN_PRIMARY} onClick={startAdd} disabled={busy || atLimit}>
            Add a scene
          </button>
        )}
      </div>
      {atLimit && !editing && <p className="mt-2 text-sm text-gray-600">A session can have {SCENES_MAX} scenes.</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {editing && (
        <form
          className="mt-4 space-y-4 rounded-2xl bg-gray-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          aria-label={editing.id ? "Edit scene" : "Add a scene"}
        >
          <p className="rounded-lg bg-lions-gold/20 p-3 text-sm font-medium text-gray-900" role="note">
            {SCENE_EDITOR_WARNING}
          </p>
          <div>
            <label htmlFor="scene-title" className={LABEL}>
              Title
            </label>
            <input
              id="scene-title"
              className={INPUT}
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "scene-title-error scene-title-count" : "scene-title-count"}
              required
            />
            <p id="scene-title-count" className="mt-1 text-xs text-gray-500">
              {[...editing.title].length} of {SCENE_TITLE_MAX} characters
            </p>
            {errors.title && (
              <p id="scene-title-error" role="alert" className="mt-1 text-sm text-red-700">
                {errors.title}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="scene-caption" className={LABEL}>
              Caption (optional)
            </label>
            <textarea
              id="scene-caption"
              className={`${INPUT} min-h-[96px]`}
              rows={3}
              value={editing.caption}
              onChange={(e) => setEditing({ ...editing, caption: e.target.value })}
              aria-invalid={errors.caption ? true : undefined}
              aria-describedby={errors.caption ? "scene-caption-error scene-caption-count" : "scene-caption-count"}
            />
            <p id="scene-caption-count" className="mt-1 text-xs text-gray-500">
              {[...editing.caption].length} of {SCENE_CAPTION_MAX} characters
            </p>
            {errors.caption && (
              <p id="scene-caption-error" role="alert" className="mt-1 text-sm text-red-700">
                {errors.caption}
              </p>
            )}
          </div>
          {errors.form && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {errors.form}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {busy ? "Saving…" : editing.id ? "Save scene" : "Add scene"}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {scenes.length === 0 && !editing ? (
        <div className={`${EMPTY} mt-4`}>
          <p className="font-medium">No scenes yet.</p>
          <p className="mt-1 text-sm">Without scenes the collage shows one list of group pictures. Add a scene to tell the day as a story.</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3" data-testid="scenes-list">
          {scenes.map((s, i) => {
            const c = photoCountText(s);
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 rounded-2xl border border-gray-200 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 break-words">
                    <span className="text-gray-500">{i + 1}.</span> {s.title}
                  </p>
                  {s.caption && <p className="mt-1 text-sm text-gray-700 break-words">{s.caption}</p>}
                  <p className="mt-2">{c.warn ? <Chip tone="amber">{c.text}</Chip> : <span className="text-sm text-gray-500">{c.text}</span>}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={`${BTN_SMALL} min-w-[44px]`} disabled={busy || i === 0} onClick={() => void move(i, -1)} aria-label={`Move ${s.title} up`}>
                    <span aria-hidden="true">&uarr;</span>
                  </button>
                  <button type="button" className={`${BTN_SMALL} min-w-[44px]`} disabled={busy || i === scenes.length - 1} onClick={() => void move(i, 1)} aria-label={`Move ${s.title} down`}>
                    <span aria-hidden="true">&darr;</span>
                  </button>
                  <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => setDeleteTarget(s)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {scenes.length === 0 && !editing && copySources.length > 0 && (
        <div className="mt-4 rounded-2xl bg-gray-50 p-4" data-testid="scenes-copy">
          <label htmlFor="scenes-copy-from" className={LABEL}>
            Copy scenes from another session
          </label>
          <p className="mt-1 text-sm text-gray-600">Copies the titles, captions and order. Photos are not copied.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <select id="scenes-copy-from" className={`${INPUT} sm:max-w-md`} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} disabled={busy}>
              <option value="">Choose a session</option>
              {copySources.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({KIND_LABELS[c.kind as SessionKind] ?? c.kind}, {c.sceneCount} scene{c.sceneCount === 1 ? "" : "s"})
                </option>
              ))}
            </select>
            <button type="button" className={BTN_SECONDARY} disabled={busy || !copySource} onClick={() => setCopyOpen(true)}>
              Copy scenes
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title="Copy these scenes?"
        description={
          copySource
            ? `This copies ${copySource.sceneCount} scene${copySource.sceneCount === 1 ? "" : "s"} from ${copySource.name} into this session. The text is public once the collage is published. Photos are not copied.`
            : ""
        }
        confirmLabel="Copy scenes"
        onConfirm={() => void copyStoryline()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this scene?"
        description={
          deleteTarget
            ? `${deleteTarget.photoCount === 0 ? "No photos are in this scene." : `${deleteTarget.photoCount} photo${deleteTarget.photoCount === 1 ? " is" : "s are"} in this scene and will move to “Other pictures”.`} The photos are not deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete scene"
        destructive
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
      />
    </section>
  );
}
