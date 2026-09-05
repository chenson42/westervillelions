"use client";

import { useState } from "react";

interface LeadershipAvatarProps {
  src: string;
  alt: string;
  /**
   * Whether the member has a stored profile picture. When false, the
   * initials chip renders immediately and `src` is never requested — the
   * caller already knows the photo endpoint would 404, so there's no reason
   * to issue a doomed request for it (site-review batch 4, 2026-09-04).
   */
  hasPhoto: boolean;
  /** 1-2 letter initials shown in the fallback chip, e.g. "JD". */
  initials: string;
  /** Square size classes, e.g. "w-20 h-20". Defaults to the leadership grid's size. */
  sizeClassName?: string;
}

/**
 * Renders a leadership photo with a graceful fallback to an initials chip
 * (lions-blue/10 circle, lions-blue text) when the member has no photo set,
 * or if the photo endpoint unexpectedly 404s.
 */
export function LeadershipAvatar({
  src,
  alt,
  hasPhoto,
  initials,
  sizeClassName = "w-20 h-20 sm:w-24 sm:h-24",
}: LeadershipAvatarProps) {
  const [failed, setFailed] = useState(!hasPhoto);

  if (failed) {
    return (
      <div
        className={`${sizeClassName} rounded-full mx-auto mb-3 flex items-center justify-center bg-lions-blue/10 text-lions-blue font-semibold text-lg`}
        aria-hidden="true"
      >
        {initials}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${sizeClassName} rounded-full object-cover mx-auto mb-3 border border-gray-200`}
      onError={() => setFailed(true)}
    />
  );
}
