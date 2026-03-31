"use client";

import { useState } from "react";
import { ShadowAvatar } from "./shadow-avatar";

interface LeadershipAvatarProps {
  src: string;
  alt: string;
}

/**
 * Renders a leadership photo with a graceful fallback to ShadowAvatar
 * when the photo endpoint returns 404 (member has no photo set).
 */
export function LeadershipAvatar({ src, alt }: LeadershipAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-32 h-32 rounded-full overflow-hidden mx-auto mb-3 border border-gray-200">
        <ShadowAvatar />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-32 h-32 rounded-full object-cover mx-auto mb-3 border border-gray-200"
      onError={() => setFailed(true)}
    />
  );
}
