"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { collagePhotoPath, type CollageTile } from "@/lib/santas-workshop/collage-contract";
import { COLLAGE_COPY, publicTileAlt } from "@/lib/santas-workshop/collage-ui";

/**
 * The public collage grid. Receives photo ids and a kind only (no names, no captions).
 * Thumbs lazy-load with width and height so nothing jumps; a tap opens the full picture;
 * a picture the store cannot serve shows a quiet placeholder instead of a broken icon.
 */
export function CollageGallery({ tiles, kind }: { tiles: CollageTile[]; kind: "group" | "portrait" }) {
  const [open, setOpen] = useState<{ id: string; alt: string } | null>(null);
  const group = kind === "group";
  return (
    <>
      <ul
        className={`sw-collage-grid grid gap-3 ${group ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}
        data-testid={`collage-${kind}`}
      >
        {tiles.map((t, i) => (
          <Tile key={t.id} id={t.id} kind={kind} alt={publicTileAlt(kind, i)} onOpen={() => setOpen({ id: t.id, alt: publicTileAlt(kind, i) })} />
        ))}
      </ul>
      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">{open?.alt ?? "Photo"}</Dialog.Title>
            {open && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the photo door
              <img src={collagePhotoPath(open.id, "full")} alt={open.alt} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
            )}
            <Dialog.Close className="absolute right-3 top-3 min-h-[44px] rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-gold">
              {COLLAGE_COPY.close}
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Tile({ id, kind, alt, onOpen }: { id: string; kind: "group" | "portrait"; alt: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const group = kind === "group";
  return (
    <li className="sw-collage-tile">
      <button
        type="button"
        onClick={onOpen}
        disabled={broken}
        className={`block w-full overflow-hidden rounded-2xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-lions-blue ${group ? "aspect-[4/3]" : "aspect-[3/4]"}`}
      >
        {broken ? (
          <span className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500">{COLLAGE_COPY.tileMissing}</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by the photo door, not a static asset
          <img
            src={collagePhotoPath(id, "thumb")}
            alt={alt}
            width={group ? 480 : 360}
            height={group ? 360 : 480}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="h-full w-full bg-gray-100 object-contain"
          />
        )}
      </button>
    </li>
  );
}
