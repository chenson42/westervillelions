interface ShadowAvatarProps {
  className?: string;
}

/**
 * Gender-neutral silhouette placeholder for member profile pictures.
 * Renders an inline SVG that scales to fill its container.
 */
export function ShadowAvatar({ className }: ShadowAvatarProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Background circle */}
      <circle cx="50" cy="50" r="50" fill="#f3f4f6" />
      {/* Head */}
      <circle cx="50" cy="36" r="16" fill="#d1d5db" />
      {/* Torso / shoulders arc */}
      <path
        d="M 15 95 Q 15 65 50 65 Q 85 65 85 95"
        fill="#d1d5db"
      />
    </svg>
  );
}
