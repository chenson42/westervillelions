/**
 * Turns a Zeffy share link into its embed URL. Plain module (no "use client")
 * so both the ZeffyEmbed modal and server-rendered pages can use the one
 * definition; the locale prefix Zeffy sometimes adds (en-US/) is dropped.
 */
export function toEmbedUrl(zeffyLink: string): string {
  if (zeffyLink.includes("/embed/")) return zeffyLink;
  return zeffyLink.replace(
    /^https:\/\/www\.zeffy\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?/,
    "https://www.zeffy.com/embed/"
  );
}
