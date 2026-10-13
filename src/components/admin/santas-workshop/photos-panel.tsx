"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  AdminPhotoDto,
  CollageAdminInfo,
  HidePhotoRequest,
  HidePhotoResponse,
  PhotoCounts,
  PhotoListKind,
  PhotosListResponse,
  PublishRequest,
  PublishResponse,
  ReviewPhotosRequest,
  ReviewPhotosResponse,
  SessionKind,
} from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import { collagePhotoPath } from "@/lib/santas-workshop/collage-contract";
import { REVIEW_INSTRUCTION, UNHIDE_NEEDS_PUBLISH, adminTileAlt, latePicturesSentence, photoMarkers, publishRefusedText, publishStatusLine, reviewDisabledReason } from "@/lib/santas-workshop/collage-ui";
import { Chip } from "./badges";
import { CollageQr } from "./collage-qr";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, EMPTY } from "./styles";

export interface PhotosPanelProps {
  sessionId: string;
  sessionKind: SessionKind;
  purged: boolean;
  initial: {
    group: Pick<PhotosListResponse, "photos" | "hasMore">;
    portrait: Pick<PhotosListResponse, "photos" | "hasMore">;
    counts: PhotoCounts;
    collage: CollageAdminInfo;
  };
}

interface Bucket {
  photos: AdminPhotoDto[];
  hasMore: boolean;
  pages: number;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Couldn’t copy automatically. Select the text and copy it by hand.");
  }
}

export function PhotosPanel({ sessionId, sessionKind, purged, initial }: PhotosPanelProps) {
  const [group, setGroup] = useState<Bucket>({ ...initial.group, pages: 1 });
  const [portrait, setPortrait] = useState<Bucket>({ ...initial.portrait, pages: 1 });
  const [counts, setCounts] = useState(initial.counts);
  const [collage, setCollage] = useState(initial.collage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hideTarget, setHideTarget] = useState<AdminPhotoDto | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);

  /** Reloads every page already on screen, so markers and counts match the server. */
  const reload = useCallback(
    async (gPages = group.pages, pPages = portrait.pages): Promise<boolean> => {
      const fetchKind = async (kind: PhotoListKind, pages: number) => {
        const out: PhotosListResponse[] = [];
        for (let p = 1; p <= pages; p += 1) {
          const res = await callAdmin<PhotosListResponse>(ADMIN_API.photos(sessionId, kind, p));
          if (!res.ok) throw new Error(res.failure.message);
          out.push(res.data);
        }
        return out;
      };
      try {
        const [g, p] = await Promise.all([fetchKind("group", gPages), fetchKind("portrait", pPages)]);
        setGroup({ photos: g.flatMap((r) => r.photos), hasMore: g[g.length - 1].hasMore, pages: gPages });
        setPortrait({ photos: p.flatMap((r) => r.photos), hasMore: p[p.length - 1].hasMore, pages: pPages });
        setCounts(g[0].counts);
        setCollage(g[0].collage);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not refresh the photos.");
        return false;
      }
    },
    [group.pages, portrait.pages, sessionId],
  );

  async function showMore(kind: PhotoListKind) {
    const bucket = kind === "group" ? group : portrait;
    setBusy(true);
    setError(null);
    const res = await callAdmin<PhotosListResponse>(ADMIN_API.photos(sessionId, kind, bucket.pages + 1));
    setBusy(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    const next: Bucket = { photos: [...bucket.photos, ...res.data.photos], hasMore: res.data.hasMore, pages: bucket.pages + 1 };
    (kind === "group" ? setGroup : setPortrait)(next);
  }

  async function setHidden(photo: AdminPhotoDto, hidden: boolean) {
    setHideTarget(null);
    setBusy(true);
    setError(null);
    setRefusal(null);
    setHint(null);
    const body: HidePhotoRequest = { hidden };
    const res = await callAdmin<HidePhotoResponse>(ADMIN_API.hidePhoto(photo.id), { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      setBusy(false);
      setError(res.failure.message);
      return;
    }
    await reload();
    setBusy(false);
    if (!hidden && res.data.needsPublish) setHint(UNHIDE_NEEDS_PUBLISH);
    toast.success(res.data.noop ? "Already that way." : hidden ? "Photo hidden." : "Photo is no longer hidden.");
  }

  async function markReviewed() {
    if (!counts.newestGroupPhotoId) return;
    setBusy(true);
    setError(null);
    setRefusal(null);
    const body: ReviewPhotosRequest = { throughPhotoId: counts.newestGroupPhotoId };
    const res = await callAdmin<ReviewPhotosResponse>(ADMIN_API.reviewPhotos(sessionId), { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      setBusy(false);
      setError(res.failure.message);
      return;
    }
    await reload();
    setBusy(false);
    toast.success("Group photos marked as reviewed.");
  }

  async function publish(action: PublishRequest["action"]) {
    setUnpublishOpen(false);
    setBusy(true);
    setError(null);
    setRefusal(null);
    const body: PublishRequest = { action };
    const res = await callAdmin<PublishResponse>(ADMIN_API.publish(sessionId), { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      setBusy(false);
      if (res.failure.code === "photos_unreviewed") setRefusal(publishRefusedText(res.failure.count));
      else setError(res.failure.message);
      return;
    }
    await reload();
    setBusy(false);
    toast.success(
      action === "publish"
        ? res.data.noop
          ? "The collage was already published."
          : "The collage is live."
        : res.data.noop
          ? "The collage was not published."
          : "The collage is unpublished.",
    );
  }

  const reviewBlocked = reviewDisabledReason(counts);

  return (
    <div className="space-y-6" aria-busy={busy}>
      <section className={`${CARD} p-6`} aria-labelledby="collage-heading">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="collage-heading" className="text-lg font-semibold text-gray-900">
            Collage
          </h2>
          <Chip tone={collage.published ? "green" : "gray"}>{collage.published ? "Published" : "Not published"}</Chip>
          {sessionKind === "practice" && <Chip tone="gold">Practice</Chip>}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          The collage shows group pictures and the portraits of stuffies whose family agreed. It never shows a child or a name. Anyone who has the link can open it once it is published.
        </p>

        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
          <div className="min-w-0 space-y-3">
            <div>
              <label htmlFor="collage-url" className="block text-sm font-medium text-gray-700 mb-1">
                Collage link
              </label>
              <input
                id="collage-url"
                readOnly
                value={collage.url}
                onFocus={(e) => e.currentTarget.select()}
                className="block w-full min-h-[44px] rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={BTN_SMALL} onClick={() => void copy(collage.url, "Collage link")}>
                Copy link
              </button>
              <a href={collage.url} target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
                Open the collage
              </a>
            </div>
            <p className="text-sm text-gray-600" role="status">
              {publishStatusLine(collage, counts)}
            </p>
            {refusal && (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {refusal}
              </p>
            )}
            {collage.published && counts.awaitingPublish > 0 && (
              <p role="status" className="text-sm text-gray-700">
                {latePicturesSentence(counts.awaitingPublish)}
              </p>
            )}
            {hint && (
              <p role="status" className="rounded-lg bg-lions-blue/5 p-3 text-sm text-lions-blue-dark">
                {hint}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {collage.published ? (
                <button type="button" className={BTN_SECONDARY} disabled={busy || purged} onClick={() => setUnpublishOpen(true)}>
                  Unpublish
                </button>
              ) : (
                <button type="button" className={BTN_PRIMARY} disabled={busy || purged} onClick={() => void publish("publish")}>
                  Publish the collage
                </button>
              )}
              {collage.published && (
                <button type="button" className={BTN_SMALL} disabled={busy || purged} onClick={() => void publish("publish")}>
                  Publish late photos
                </button>
              )}
            </div>
          </div>
          <figure className="space-y-2">
            <CollageQr collage={collage} />
            <figcaption className="text-xs text-gray-500">The same code goes on the frames.</figcaption>
          </figure>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Count label="Group photos" value={counts.groupTotal} note={`${counts.groupHidden} hidden`} />
          <Count label="Not reviewed" value={counts.groupUnreviewed} warn={counts.groupUnreviewed > 0} />
          <Count label="Portraits on the collage" value={counts.portraitsOnCollage} />
          <Count label="No consent" value={counts.portraitsNotConsented} note="kept off the collage" />
        </dl>
      </section>

      <section aria-labelledby="group-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="group-heading" className="text-lg font-semibold text-gray-900">
            Group photos
          </h2>
          <button type="button" className={BTN_PRIMARY} disabled={busy || purged || reviewBlocked !== null} onClick={() => void markReviewed()} aria-describedby={reviewBlocked ? "review-why" : undefined}>
            Mark group photos reviewed
          </button>
        </div>
        {reviewBlocked && (
          <p id="review-why" className="text-sm text-gray-500">
            {reviewBlocked}
          </p>
        )}
        <p className="text-sm text-gray-600">Look at each picture. {REVIEW_INSTRUCTION} Then mark them reviewed so the collage can be published.</p>
        <Grid photos={group.photos} kind="group" busy={busy} purged={purged} onHide={setHideTarget} onUnhide={(p) => void setHidden(p, false)} />
        {group.hasMore && (
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => void showMore("group")}>
            Show more group photos
          </button>
        )}
      </section>

      <section aria-labelledby="portrait-heading" className="space-y-3">
        <h2 id="portrait-heading" className="text-lg font-semibold text-gray-900">
          Stuffy portraits
        </h2>
        <p className="text-sm text-gray-600">Only portraits whose family agreed appear on the collage. Hide one here if a portrait should not be shared.</p>
        <Grid photos={portrait.photos} kind="portrait" busy={busy} purged={purged} onHide={setHideTarget} onUnhide={(p) => void setHidden(p, false)} />
        {portrait.hasMore && (
          <button type="button" className={BTN_SMALL} disabled={busy} onClick={() => void showMore("portrait")}>
            Show more portraits
          </button>
        )}
      </section>

      <ConfirmDialog
        open={hideTarget !== null}
        onOpenChange={(o) => !o && setHideTarget(null)}
        title="Hide this photo?"
        description="It leaves the collage and the family page right away. Someone who already has the page open may still see it for up to 5 minutes. You can unhide it later."
        confirmLabel="Hide photo"
        onConfirm={() => hideTarget && void setHidden(hideTarget, true)}
      />
      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        title="Unpublish the collage?"
        description="The link goes back to “The photos arrive on…”. Someone who already has the page open may still see the photos for up to 5 minutes."
        confirmLabel="Unpublish"
        destructive
        onConfirm={() => void publish("unpublish")}
      />
    </div>
  );
}

function Count({ label, value, note, warn }: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`text-2xl font-bold ${warn ? "text-amber-700" : "text-gray-900"}`}>{value}</dd>
      {note && <dd className="text-xs text-gray-500">{note}</dd>}
    </div>
  );
}

function Grid({
  photos,
  kind,
  busy,
  purged,
  onHide,
  onUnhide,
}: {
  photos: AdminPhotoDto[];
  kind: PhotoListKind;
  busy: boolean;
  purged: boolean;
  onHide: (p: AdminPhotoDto) => void;
  onUnhide: (p: AdminPhotoDto) => void;
}) {
  if (photos.length === 0) {
    return (
      <div className={EMPTY}>
        <p className="font-medium">{kind === "group" ? "No group photos yet." : "No portraits yet."}</p>
        <p className="mt-1 text-sm">{kind === "group" ? "Workers add them from the Group photo button on the crew app." : "Portraits appear here as workers take them."}</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid={`${kind}-grid`}>
      {photos.map((p, i) => (
        <PhotoTile key={p.id} photo={p} index={i} busy={busy} purged={purged} onHide={onHide} onUnhide={onUnhide} />
      ))}
    </ul>
  );
}

function PhotoTile({
  photo,
  index,
  busy,
  purged,
  onHide,
  onUnhide,
}: {
  photo: AdminPhotoDto;
  index: number;
  busy: boolean;
  purged: boolean;
  onHide: (p: AdminPhotoDto) => void;
  onUnhide: (p: AdminPhotoDto) => void;
}) {
  const [broken, setBroken] = useState(false);
  const m = photoMarkers(photo);
  const ratio = photo.kind === "group" ? "aspect-[4/3]" : "aspect-[3/4]";
  return (
    <li className={`${CARD} flex flex-col`} data-photo-id={photo.id}>
      <div className={`relative ${ratio} bg-gray-100`}>
        {broken ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500">Photo not available right now</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by the photo door, not a static asset
          <img
            src={collagePhotoPath(photo.id, "thumb")}
            alt={adminTileAlt(photo, index)}
            width={photo.kind === "group" ? 480 : 360}
            height={photo.kind === "group" ? 360 : 480}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className={`h-full w-full object-cover ${photo.hidden ? "opacity-40" : ""}`}
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {photo.kind === "portrait" && photo.stuffyName && <p className="font-semibold text-gray-900 break-words">{photo.stuffyName}</p>}
        <div className="flex flex-wrap gap-1.5">
          {m.hidden && <Chip tone="red">Hidden</Chip>}
          {m.consentLabel && m.consentTone && <Chip tone={m.consentTone}>{m.consentLabel}</Chip>}
          {m.reviewLabel && <Chip tone={photo.reviewed ? "green" : "amber"}>{m.reviewLabel}</Chip>}
          {m.visibleLabel && <Chip tone="blue">{m.visibleLabel}</Chip>}
        </div>
        <div className="mt-auto pt-1">
          {photo.hidden ? (
            <button type="button" className={BTN_SMALL} disabled={busy || purged} onClick={() => onUnhide(photo)}>
              Unhide
            </button>
          ) : (
            <button type="button" className={BTN_SMALL} disabled={busy || purged} onClick={() => onHide(photo)}>
              Hide
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
