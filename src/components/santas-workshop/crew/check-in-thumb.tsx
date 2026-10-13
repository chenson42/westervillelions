"use client";

import { photoUrl } from "./crew-api";
import { CREW_CARD } from "./crew-styles";

/**
 * The check-in photo: the "is this the right stuffy" check and the damage record.
 * `loading` hides the line until the card has been read, so "without a photo" never flashes.
 */
export function CheckInThumb({ photoId, name, loading = false }: { photoId: string | null; name: string; loading?: boolean }) {
  if (loading) return null;
  return (
    <div className={`${CREW_CARD} p-4`}>
      <p className="mb-2 text-sm font-semibold text-gray-500">Check-in photo</p>
      {photoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the photo door
        <img src={photoUrl(photoId, "full")} alt={`Check-in photo of ${name}`} className="max-h-[32vh] w-full rounded-2xl bg-gray-100 object-contain" />
      ) : (
        <p className="text-gray-700">Checked in without a photo</p>
      )}
    </div>
  );
}
