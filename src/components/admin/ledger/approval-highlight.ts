/**
 * Server-rendered classes for the row a `?txn=` deep link points at. Shared by
 * the pending card, the pending table row and the History card so the three
 * cannot drift. The ring stays (RowHighlighter `persistent` only scrolls and
 * focuses), so there is no timer to race the screen-reader announcement.
 */
export const HIGHLIGHT_CLASSES =
  "ring-2 ring-lions-gold bg-lions-gold/10 scroll-mt-24 focus:outline-none";
