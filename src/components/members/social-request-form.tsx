"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { computeResizeDimensions } from "@/lib/image-resize";
import {
  SOCIAL_REQUEST_PLATFORMS,
  socialRequestPlatformLabel,
  POST_COPY_MAX_LEN,
  NOTES_MAX_LEN,
  MAX_IMAGE_DATA_URI_LENGTH,
  type SocialRequestPlatform,
} from "@/lib/social-requests";

/**
 * Single scrolling form, mirrors `proposal-form.tsx`'s shape exactly: hand-rolled
 * useState + fetch (no react-hook-form), debounced (~2s) autosave once an id
 * exists, an explicit Save/Discard/Submit action row, 44px+ tap targets, every
 * required field marked "Required," every optional field marked "(optional)."
 *
 * Deviation from "always send full state": every other field is resent in
 * full on every autosave tick, but `imageDataUri` is included in a save's
 * body only when the image was actually added/changed/removed in that tick
 * (tracked via `imageDirty`) — resending an unchanged ~300KB base64 string on
 * every 2s autosave tick has no upside. `parseSocialRequestBody()` treats
 * `imageDataUri: undefined` (key absent) as "leave unchanged."
 *
 * Client-side downscale before upload reuses the pure math
 * `computeResizeDimensions()` from `src/lib/image-resize.ts` with constants
 * scoped locally to this component (1200px / 0.82 JPEG quality) — this is a
 * UX nicety only; the server's ~300KB cap and `validateMagicBytes()` check
 * remain the actual trust boundary.
 */

const IMAGE_MAX_DIMENSION = 1200;
const IMAGE_JPEG_QUALITY = 0.82;

export interface SocialRequestFormInitial {
  id: string;
  status: string;
  platforms: string[];
  postCopy: string | null;
  imageDataUri: string | null;
  linkUrl: string | null;
  desiredPostDate: string | null;
  notes: string | null;
  submittedAt: string | null;
}

interface SocialRequestFormProps {
  /** null for a brand-new request — no id has been minted yet. */
  request: SocialRequestFormInitial | null;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string | null;
}

function formatSubmittedDate(iso: string | null): string {
  if (!iso) return "Not yet submitted";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Small presentational helpers (mirror proposal-form.tsx's shape)
// ---------------------------------------------------------------------------

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-base font-semibold text-gray-800 mb-1.5">
      {children}{" "}
      {required ? (
        <span className="text-red-600 font-normal text-sm align-middle">Required</span>
      ) : (
        <span className="text-gray-400 font-normal text-sm align-middle">(optional)</span>
      )}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-sm text-red-600" role="alert">
      {message}
    </p>
  );
}

const inputClass =
  "block w-full min-h-[44px] rounded-lg border border-gray-300 py-2.5 px-3 text-base text-gray-900 focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60 disabled:bg-gray-50";

function SaveStateIndicator({ state }: { state: "idle" | "dirty" | "saving" | "saved" | "error" }) {
  if (state === "saving") return <p className="text-sm text-gray-500">Saving…</p>;
  if (state === "dirty") return <p className="text-sm text-gray-500">Unsaved changes</p>;
  if (state === "saved") return <p className="text-sm text-green-700">All changes saved</p>;
  if (state === "error") return <p className="text-sm text-red-600">Couldn&rsquo;t save — check your connection</p>;
  return <p className="text-sm text-gray-400">&nbsp;</p>;
}

async function resizeImageToDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = computeResizeDimensions(bitmap.width, bitmap.height, IMAGE_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export function SocialRequestForm({ request, requesterName, requesterEmail, requesterPhone }: SocialRequestFormProps) {
  const router = useRouter();

  const [id, setId] = useState<string | null>(request?.id ?? null);
  const [status, setStatus] = useState<string>(request?.status ?? "draft");
  const [submittedAt, setSubmittedAt] = useState<string | null>(request?.submittedAt ?? null);

  const [platforms, setPlatforms] = useState<string[]>(request?.platforms ?? []);
  const [postCopy, setPostCopy] = useState(request?.postCopy ?? "");
  const [linkUrl, setLinkUrl] = useState(request?.linkUrl ?? "");
  const [desiredPostDate, setDesiredPostDate] = useState(request?.desiredPostDate ?? "");
  const [notes, setNotes] = useState(request?.notes ?? "");

  const [imageDataUri, setImageDataUri] = useState<string | null>(request?.imageDataUri ?? null);
  const [imageDirty, setImageDirty] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const isFirstRender = useRef(true);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const idRef = useRef(id);
  idRef.current = id;
  const lockedRef = useRef(lockedMessage);
  lockedRef.current = lockedMessage;
  const imageDirtyRef = useRef(imageDirty);
  imageDirtyRef.current = imageDirty;

  function togglePlatform(p: SocialRequestPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      platforms,
      postCopy: postCopy.trim() || null,
      linkUrl: linkUrl.trim() || null,
      desiredPostDate: desiredPostDate || null,
      notes: notes.trim() || null,
    };
    // imageDataUri deliberately omitted unless dirty — see file doc comment.
    if (imageDirtyRef.current) {
      payload.imageDataUri = imageDataUri;
    }
    return payload;
  }

  /**
   * Promise-based mutex — see proposal-form.tsx's identical doc comment for
   * why this is a promise, not a boolean flag: a caller arriving mid-save
   * must await and re-issue, never bail out early (found via a Proposals
   * Phase 4 QA click-through; the same risk applies here).
   */
  async function persist(): Promise<boolean> {
    if (lockedRef.current) return false;
    if (savingPromiseRef.current) {
      await savingPromiseRef.current.catch(() => {});
      return persist();
    }
    const run = persistOnce();
    savingPromiseRef.current = run;
    try {
      return await run;
    } finally {
      savingPromiseRef.current = null;
    }
  }

  async function persistOnce(): Promise<boolean> {
    setSaveState("saving");
    const sentImage = imageDirtyRef.current;
    try {
      const payload = buildPayload();
      const wasNew = !idRef.current;
      const res = idRef.current
        ? await fetch(`/api/members/social-requests/${idRef.current}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/members/social-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setLockedMessage(data.error || "This request is locked for review and can no longer be edited.");
        setSaveState("error");
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save your changes.");
      }
      const data = await res.json();
      if (wasNew) {
        setId(data.socialRequest.id);
        idRef.current = data.socialRequest.id;
        // The URL still reads /members/social-requests/new even though a
        // real draft row now exists — replace it so a page reload resumes
        // this draft instead of silently starting a second, orphaned one.
        router.replace(`/members/social-requests/${data.socialRequest.id}`);
      }
      setStatus(data.socialRequest.status);
      setSaveState("saved");
      if (sentImage) {
        setImageDirty(false);
        imageDirtyRef.current = false;
      }
      return true;
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof Error ? err.message : "Could not save your changes. Check your connection.");
      return false;
    }
  }

  // Debounced autosave (~2s after the last change to any field). Skips the
  // initial mount so opening an already-saved request doesn't immediately
  // re-PATCH it with identical data.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (lockedRef.current) return;
    setSaveState("dirty");
    const timer = setTimeout(() => {
      persist();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms, postCopy, linkUrl, desiredPostDate, notes, imageDataUri, imageDirty]);

  async function handleSaveNow() {
    const ok = await persist();
    if (ok) toast.success(status === "draft" ? "Draft saved." : "Changes saved.");
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    setImageProcessing(true);
    try {
      const dataUri = await resizeImageToDataUri(file);
      if (dataUri.length > MAX_IMAGE_DATA_URI_LENGTH) {
        toast.error("That image is too large even after resizing. Try a smaller or simpler photo.");
        return;
      }
      setImageDataUri(dataUri);
      setImageDirty(true);
    } catch {
      toast.error("Could not process that image. Try a different photo.");
    } finally {
      setImageProcessing(false);
    }
  }

  function handleRemoveImage() {
    setImageDataUri(null);
    setImageDirty(true);
  }

  function validateClientSide(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (platforms.length === 0) errors.platforms = "Choose at least one platform to post to";
    if (!postCopy.trim()) errors.postCopy = "Post copy/caption is required";
    return errors;
  }

  async function handleSubmit() {
    const errors = validateClientSide();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error("Please fill in the required fields, highlighted below.");
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const saved = await persist();
      if (!saved) {
        toast.error("Could not save your latest changes before submitting. Please try again.");
        return;
      }
      const targetId = idRef.current;
      const res = await fetch(`/api/members/social-requests/${targetId}/submit`, { method: "POST" });

      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        setFieldErrors(data.errors || {});
        toast.error("Please fix the highlighted fields and submit again.");
        return;
      }
      if (res.status === 409) {
        toast.success("This request has already been submitted.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not submit your request. Please try again.");
      }
      const data = await res.json();
      setStatus(data.socialRequest.status);
      setSubmittedAt(data.socialRequest.submittedAt);
      toast.success("Request submitted! The board will review it and you'll be emailed the outcome.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDiscard() {
    if (!idRef.current) return;
    setDiscarding(true);
    try {
      const res = await fetch(`/api/members/social-requests/${idRef.current}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not discard this draft.");
      }
      toast.success("Draft discarded.");
      router.push("/members/social-requests");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not discard this draft.");
    } finally {
      setDiscarding(false);
      setDiscardOpen(false);
    }
  }

  const isDraft = status === "draft";
  const disabled = !!lockedMessage;

  return (
    <div className="space-y-8">
      {lockedMessage && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-800">
          {lockedMessage}
        </div>
      )}

      {/* Auto-filled, read-only requester info. */}
      <div className="grid gap-x-6 gap-y-2 rounded-2xl bg-gray-50 p-5 text-base text-gray-600 sm:grid-cols-2">
        <div>
          <span className="font-semibold text-gray-700">Requested by: </span>
          {requesterName}
        </div>
        <div>
          <span className="font-semibold text-gray-700">Email: </span>
          {requesterEmail}
        </div>
        {requesterPhone && (
          <div>
            <span className="font-semibold text-gray-700">Phone: </span>
            {requesterPhone}
          </div>
        )}
        <div>
          <span className="font-semibold text-gray-700">Submitted: </span>
          {formatSubmittedDate(submittedAt)}
        </div>
      </div>

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-5">
        <h2 className="text-xl font-bold text-gray-900">The Post</h2>

        <fieldset>
          <legend className="block text-base font-semibold text-gray-800 mb-1.5">
            Platform(s) to post to <span className="text-red-600 font-normal text-sm align-middle">Required</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SOCIAL_REQUEST_PLATFORMS.map((p) => {
              const checked = platforms.includes(p);
              const inputId = `social-request-platform-${p}`;
              return (
                <label
                  key={p}
                  htmlFor={inputId}
                  className={`flex items-center gap-2 rounded-lg border p-3 min-h-[44px] cursor-pointer transition focus-within:ring-2 focus-within:ring-lions-blue ${
                    checked ? "border-lions-blue bg-lions-blue/5" : "border-gray-300 hover:bg-gray-50"
                  } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePlatform(p)}
                    disabled={disabled}
                    className="h-5 w-5 flex-shrink-0 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                  />
                  <span className="text-base font-medium text-gray-900">{socialRequestPlatformLabel(p)}</span>
                </label>
              );
            })}
          </div>
          <FieldError message={fieldErrors.platforms} />
        </fieldset>

        <div>
          <FieldLabel htmlFor="social-request-copy" required>
            Post copy / caption
          </FieldLabel>
          <textarea
            id="social-request-copy"
            value={postCopy}
            onChange={(e) => setPostCopy(e.target.value)}
            rows={5}
            maxLength={POST_COPY_MAX_LEN}
            disabled={disabled}
            placeholder="What should the post say?"
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-sm text-gray-400">
            {postCopy.length}/{POST_COPY_MAX_LEN} characters
          </p>
          <FieldError message={fieldErrors.postCopy} />
        </div>

        <div>
          <FieldLabel htmlFor="social-request-image">Image</FieldLabel>
          {imageDataUri && (
            <div className="mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageDataUri}
                alt="Attached image preview"
                className="max-h-56 rounded-lg border border-gray-200"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="social-request-image"
              className={`inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border-2 border-lions-blue px-4 py-2 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus-within:ring-2 focus-within:ring-lions-blue ${
                disabled || imageProcessing ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {imageProcessing ? "Processing…" : imageDataUri ? "Replace Image" : "Add Image"}
              <input
                id="social-request-image"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
                disabled={disabled || imageProcessing}
              />
            </label>
            {imageDataUri && (
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={disabled || imageProcessing}
                className="min-h-[44px] rounded-lg px-3 py-2 text-base font-medium text-gray-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-60"
              >
                Remove Image
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-400">JPEG or PNG. Resized automatically to roughly 300KB or less.</p>
        </div>

        <div>
          <FieldLabel htmlFor="social-request-link">Link</FieldLabel>
          <input
            id="social-request-link"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            disabled={disabled}
            className={inputClass}
            placeholder="https://example.com/flyer-or-event-page"
          />
          <p className="mt-1 text-sm text-gray-400">A link to a flyer, event page, or existing photo — not mutually exclusive with an uploaded image.</p>
          <FieldError message={fieldErrors.linkUrl} />
        </div>

        <div>
          <FieldLabel htmlFor="social-request-date">Desired post date</FieldLabel>
          <input
            id="social-request-date"
            type="date"
            value={desiredPostDate}
            onChange={(e) => setDesiredPostDate(e.target.value)}
            disabled={disabled}
            className={inputClass}
          />
          <p className="mt-1 text-sm text-gray-400">Leave blank if you have no preference.</p>
        </div>

        <div>
          <FieldLabel htmlFor="social-request-notes">Notes</FieldLabel>
          <textarea
            id="social-request-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={NOTES_MAX_LEN}
            disabled={disabled}
            placeholder="Anything else the board should know?"
            className={`${inputClass} resize-none`}
          />
        </div>
      </section>

      {/* Save state + actions */}
      <div className="flex flex-col gap-4 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <SaveStateIndicator state={saveState} />
        <div className="flex flex-wrap gap-3">
          {isDraft && id && (
            <button
              type="button"
              onClick={() => setDiscardOpen(true)}
              disabled={disabled || discarding}
              className="min-h-[44px] rounded-lg px-3 py-2 text-base font-medium text-gray-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-60"
            >
              Discard Draft
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveNow}
            disabled={disabled || imageProcessing}
            className="min-h-[44px] rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
          >
            {isDraft ? "Save Draft" : "Save Changes"}
          </button>
          {isDraft && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || submitting || imageProcessing}
              className="min-h-[44px] rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          )}
        </div>
      </div>

      {!isDraft && status === "submitted" && (
        <p className="text-base text-gray-500">
          Submitted — the board reviews requests as they come in. You can keep editing until a reviewer begins
          looking at it.
        </p>
      )}

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this draft?"
        description="This will permanently delete this draft social media request. This cannot be undone."
        confirmLabel="Discard Draft"
        destructive
        onConfirm={handleDiscard}
      />
    </div>
  );
}
