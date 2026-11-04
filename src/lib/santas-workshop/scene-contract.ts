/**
 * CARRIER for the storyline ("scenes") API (DECISION-128). Client-safe: NO database,
 * server-only or Node imports. A scene is session-level configuration: a title, an
 * optional caption and an order. A group photo carries only a nullable pointer to
 * one. The admin card, the photos page and the tests import every request/response
 * type and the closed `SceneRejectReason` vocabulary from here, so removing or
 * widening a member breaks `tsc` including every client consumer.
 *
 * Scene text is PUBLIC (it prints on the collage). The counts in `AdminSceneDto` are
 * admin-only and never reach the collage (R9).
 */

export const SCENE_TITLE_MAX = 60;
export const SCENE_CAPTION_MAX = 280;
export const SCENES_MAX = 20;

/** Required wherever scene text is typed. It cannot be machine-enforced beyond the shape checks. */
export const SCENE_EDITOR_WARNING = "This text is public. Do not use the names of children, families or stuffies.";

export interface SceneTextInput {
  title: string;
  caption: string | null;
}

export const SCENE_REJECT_REASONS = [
  "title_required",
  "title_too_long",
  "caption_too_long",
  "looks_like_email",
  "looks_like_link",
  "looks_like_phone",
] as const;
export type SceneRejectReason = (typeof SCENE_REJECT_REASONS)[number];

/** The sentence the server returns (and the UI shows) for each reject reason. */
export const SCENE_REJECT_MESSAGES: Record<SceneRejectReason, string> = {
  title_required: "Give the scene a title.",
  title_too_long: `The title can be at most ${SCENE_TITLE_MAX} characters.`,
  caption_too_long: `The caption can be at most ${SCENE_CAPTION_MAX} characters.`,
  looks_like_email: "Remove the email address. Scene text is public.",
  looks_like_link: "Remove the web address. Scene text is public.",
  looks_like_phone: "Remove the phone number or long number. Write a date in words, for example Dec 18 to 20.",
};

export const SCENE_LIMIT_MESSAGE = `A session can have ${SCENES_MAX} scenes.`;
export const SCENES_CHANGED_MESSAGE = "The storyline changed in another tab. It has been refreshed.";
export const SCENE_GONE_MESSAGE = "That scene no longer exists.";

export interface AdminSceneDto {
  id: string;
  title: string;
  caption: string | null;
  position: number;
  /** Group photos currently in this scene (not purged, not superseded). Admin-only. */
  photoCount: number;
  /** Of those, how many are not hidden. Zero means the scene will not show on the collage. Admin-only. */
  unhiddenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScenesListResponse {
  scenes: AdminSceneDto[];
}
export type SceneSaveRequest = SceneTextInput;
export interface SceneSaveResponse {
  scene: AdminSceneDto;
}
export interface SceneDeleteResponse {
  ok: true;
  /** Photos that fell back to "no scene" (they appear under Other pictures). */
  movedPhotos: number;
}
export interface SceneOrderRequest {
  /** The complete list of the session's scene ids, in the new order. */
  order: string[];
}
/** Slice B. Returns ScenesListResponse. */
export interface SceneCopyRequest {
  fromSessionId: string;
}
export interface PhotoSceneRequest {
  sceneId: string | null;
}
export interface PhotoSceneResponse {
  ok: true;
  sceneId: string | null;
  sceneTitle: string | null;
}
