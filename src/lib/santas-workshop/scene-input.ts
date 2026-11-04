/**
 * Scene input validation (pure, client-safe). `validateSceneText` is the ONE gate
 * for scene text: create, update and (Slice B) copy all pass through it, and
 * `swScenes` is written only in scene-admin.ts after calling it (scan-tested).
 * `parseGroupSceneId` is the crew upload's only scene datum: a UUID, or null.
 */

import {
  SCENE_CAPTION_MAX,
  SCENE_REJECT_MESSAGES,
  SCENE_TITLE_MAX,
  type SceneRejectReason,
  type SceneTextInput,
} from "./scene-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SceneValidation =
  | { ok: true; value: SceneTextInput }
  | { ok: false; field: "title" | "caption"; reason: SceneRejectReason; error: string };

// Zero-width, bidi and invisible formatting characters.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// C0/C1 controls (tabs and newlines included) become a space.
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

/** NFC, strip invisibles, controls to spaces, collapse whitespace, trim. */
export function cleanSceneText(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

const EMAIL = /\S+@\S+\.\S+/;
const LINK = /https?:\/\/|www\./i;
const BARE_DOMAIN = /\b[a-z0-9-]+\.(com|org|net|edu|gov|io|us|co|info)\b/i;
const PHONE = /\d(?:[ ().-]?\d){6,}/;

function shapeReason(text: string): SceneRejectReason | null {
  if (EMAIL.test(text)) return "looks_like_email";
  if (LINK.test(text) || BARE_DOMAIN.test(text)) return "looks_like_link";
  if (PHONE.test(text)) return "looks_like_phone";
  return null;
}

const reject = (field: "title" | "caption", reason: SceneRejectReason): SceneValidation => ({
  ok: false,
  field,
  reason,
  error: SCENE_REJECT_MESSAGES[reason],
});

const codePoints = (s: string) => [...s].length;

/**
 * Validates and cleans a scene's title and caption. A non-string title is
 * `title_required`; an absent, null or non-string caption is no caption.
 * An empty caption is stored as null. Lengths count code points.
 */
export function validateSceneText(input: { title?: unknown; caption?: unknown } | null | undefined): SceneValidation {
  const rawTitle = input?.title;
  if (typeof rawTitle !== "string") return reject("title", "title_required");
  const title = cleanSceneText(rawTitle);
  if (title.length === 0) return reject("title", "title_required");
  if (codePoints(title) > SCENE_TITLE_MAX) return reject("title", "title_too_long");

  const rawCaption = input?.caption;
  const caption = typeof rawCaption === "string" ? cleanSceneText(rawCaption) : "";
  if (codePoints(caption) > SCENE_CAPTION_MAX) return reject("caption", "caption_too_long");

  const titleShape = shapeReason(title);
  if (titleShape) return reject("title", titleShape);
  const captionShape = shapeReason(caption);
  if (captionShape) return reject("caption", captionShape);

  return { ok: true, value: { title, caption: caption.length === 0 ? null : caption } };
}

/**
 * The scene id on a group-photo upload's multipart `meta`: a lower-cased UUID or
 * null. Absent, malformed, empty and non-string all yield null and never throw.
 * Called ONLY by the group-photos route (never folded into parsePhotoMeta).
 */
export function parseGroupSceneId(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  const raw = (meta as { sceneId?: unknown }).sceneId;
  if (typeof raw !== "string" || !UUID.test(raw)) return null;
  return raw.toLowerCase();
}

/** A list of ids that must each be a UUID with no repeats; returns lower-cased ids or null. */
export function parseSceneOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !UUID.test(v)) return null;
    ids.push(v.toLowerCase());
  }
  return new Set(ids).size === ids.length ? ids : null;
}
