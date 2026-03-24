"use client";

/**
 * Zeffy Button Component
 *
 * Opens the Zeffy donation form in a new tab.
 * Also keeps the zeffy-form-link attribute so Zeffy's embed script can
 * intercept the click and show a modal if it has initialized.
 */
interface ZeffyButtonProps {
  zeffyLink: string;
  className?: string;
  children: React.ReactNode;
}

export function ZeffyButton({ zeffyLink, className, children }: ZeffyButtonProps) {
  return (
    <a
      href={zeffyLink}
      target="_blank"
      rel="noopener noreferrer"
      // @ts-ignore - zeffy-form-link is a custom attribute used by Zeffy's embed script
      zeffy-form-link={zeffyLink}
      className={className}
    >
      {children}
    </a>
  );
}
