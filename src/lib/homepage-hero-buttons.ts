// Homepage announcements are shown only as buttons in the hero. This turns the
// active announcement rows (already filtered by isActive and the start/end
// window, ordered by sortOrder) into hero buttons. Pure and client-safe.

export const MAX_ANNOUNCEMENT_BUTTONS = 2;

export interface HeroAnnouncementButton {
  id: string;
  href: string;
  label: string;
  /** An absolute http(s) link opens in a new tab. */
  external: boolean;
}

type AnnouncementLike = {
  id: string;
  title: string;
  linkUrl: string | null;
  linkLabel: string | null;
};

export function heroAnnouncementButtons(rows: readonly AnnouncementLike[]): HeroAnnouncementButton[] {
  const buttons: HeroAnnouncementButton[] = [];
  for (const row of rows) {
    const href = row.linkUrl?.trim();
    if (!href) continue;
    buttons.push({
      id: row.id,
      href,
      label: row.linkLabel?.trim() || row.title.trim(),
      external: /^https?:\/\//i.test(href),
    });
    if (buttons.length === MAX_ANNOUNCEMENT_BUTTONS) break;
  }
  return buttons;
}
