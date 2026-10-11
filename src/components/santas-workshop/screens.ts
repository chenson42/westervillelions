// Ordered list of prototype screens. Used by the screen switcher, the flow
// footer, the art brief ("used on") and the tests. Pure module.

export const PREVIEW_BASE = "/santas-workshop/preview";

export interface PreviewScreen {
  href: string;
  label: string;
  shortLabel: string;
  who: string;
}

export const SCREENS: readonly PreviewScreen[] = [
  {
    href: PREVIEW_BASE,
    label: "Sign-up page",
    shortLabel: "Sign up",
    who: "A parent who scanned the QR code",
  },
  {
    href: `${PREVIEW_BASE}/confirmed`,
    label: "After you pay",
    shortLabel: "Booked",
    who: "A parent, minutes after paying",
  },
  {
    href: `${PREVIEW_BASE}/follow`,
    label: "Follow the journey",
    shortLabel: "Journey",
    who: "A parent, over the weekend",
  },
  {
    href: `${PREVIEW_BASE}/book`,
    label: "Memory book",
    shortLabel: "Book",
    who: "A parent, on Sunday",
  },
  {
    href: `${PREVIEW_BASE}/check-in`,
    label: "Conductor check-in",
    shortLabel: "Check-in",
    who: "A volunteer, Friday evening",
  },
  {
    href: `${PREVIEW_BASE}/photo-station`,
    label: "Photo station",
    shortLabel: "Photos",
    who: "A volunteer, Saturday",
  },
  {
    href: `${PREVIEW_BASE}/art`,
    label: "Art brief",
    shortLabel: "Art brief",
    who: "You, the artist",
  },
] as const;

export function screenIndex(href: string): number {
  return SCREENS.findIndex((s) => s.href === href);
}

export function neighbours(href: string): {
  prev: PreviewScreen | null;
  next: PreviewScreen | null;
} {
  const i = screenIndex(href);
  if (i === -1) return { prev: null, next: null };
  return { prev: SCREENS[i - 1] ?? null, next: SCREENS[i + 1] ?? null };
}
