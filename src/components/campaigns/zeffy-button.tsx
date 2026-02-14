"use client";

/**
 * Zeffy Button Component
 *
 * Creates a button that triggers the Zeffy donation modal.
 * The zeffy-form-link attribute is read by Zeffy's global script (loaded in layout).
 */
interface ZeffyButtonProps {
  zeffyLink: string;
  className?: string;
  children: React.ReactNode;
}

export function ZeffyButton({ zeffyLink, className, children }: ZeffyButtonProps) {
  return (
    <button
      // @ts-ignore - zeffy-form-link is a custom attribute used by Zeffy's script
      zeffy-form-link={zeffyLink}
      className={className}
      type="button"
    >
      {children}
    </button>
  );
}
