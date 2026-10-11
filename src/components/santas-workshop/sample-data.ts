// Fictional sample data. Cartoon-obvious on purpose: no child names, no
// surnames, no emails, phones, addresses or URLs. A test rejects any of those.

import type { DropoffWindowId, SceneDef } from "./event-facts";

export interface SampleStuffy {
  tag: string;
  familyLabel: string;
  name: string;
  kind: string;
  color: string;
  careNote?: string;
  windowId: DropoffWindowId;
  boarded: boolean;
}

function row(
  tag: string,
  family: number,
  name: string,
  kind: string,
  color: string,
  windowId: DropoffWindowId,
  boarded: boolean,
  careNote?: string,
): SampleStuffy {
  const familyLabel = `Family ${String(family).padStart(2, "0")}`;
  return careNote
    ? { tag, familyLabel, name, kind, color, careNote, windowId, boarded }
    : { tag, familyLabel, name, kind, color, windowId, boarded };
}

export const SAMPLE_STUFFIES: readonly SampleStuffy[] = [
  row("A-01", 1, "Bramble", "bear", "honey brown", "fri-early", true),
  row("A-02", 2, "Marshmallow", "bunny", "cream", "fri-early", true, "one loose eye"),
  row("A-03", 3, "Captain Waddles", "penguin", "navy hat", "fri-early", true),
  row("A-04", 4, "Juniper", "fox", "rusty orange", "fri-early", true),
  row("A-05", 5, "Biscuit", "dog", "tan with floppy ears", "fri-early", true, "very floppy ears"),
  row("A-06", 5, "Mr. Buttons", "bear", "gray, red bow tie", "fri-early", true),
  row("A-07", 6, "Nimbus", "elephant", "sky blue", "fri-early", true),
  row("A-08", 7, "Clementine", "giraffe", "yellow, orange spots", "fri-early", true),
  row("A-09", 8, "Truffle", "bear", "dark brown", "fri-early", false),
  row("A-10", 9, "Waffles", "cat", "striped", "fri-early", false, "sleeps with a night-light"),
  row("A-11", 10, "Sprout", "turtle", "green", "fri-early", false),
  row("A-12", 11, "Maple", "squirrel", "light brown", "fri-early", false),
  row("B-01", 12, "Pickles", "frog", "bright green", "fri-late", false),
  row("B-02", 13, "Gingersnap", "reindeer", "tan, jingle bell", "fri-late", false),
  row("B-03", 14, "Noodle", "snake", "purple", "fri-late", false, "extra long, please keep flat"),
  row("B-04", 15, "Pebble", "seal", "silver gray", "fri-late", false),
  row("B-05", 16, "Honeybun", "bee", "yellow and black", "fri-late", false),
  row("B-06", 17, "Sir Reginald", "lion", "golden mane", "fri-late", false),
  row("B-07", 18, "Pip", "penguin", "blue scarf", "fri-late", false),
  row("B-08", 19, "Fern", "deer", "soft tan", "fri-late", false),
  row("B-09", 20, "Cocoa", "puppy", "chocolate", "fri-late", false, "one loose eye"),
  row("B-10", 21, "Tumbleweed", "hedgehog", "sandy", "fri-late", false),
  row("B-11", 22, "Dot", "ladybug", "red with black dots", "fri-late", false),
  row("B-12", 22, "Moosely", "moose", "dark brown", "fri-late", false),
];

export const SAMPLE_JOURNEY_STUFFY: SampleStuffy = SAMPLE_STUFFIES.find((s) => s.name === "Pip")!;

export const SAMPLE_BOOK_CAPTIONS: Record<SceneDef["id"], string> = {
  wrapping: "Pip helped Mrs. Claus tie the biggest bow of the day. It only took three tries.",
  workshop: "Santa let Pip hold the tiny hammer. Pip was very careful and very proud.",
  cookies: "A cookie, a sip of cocoa, and a quiet moment to rest before the evening.",
  story: "Pip listened to the whole story, and was fast asleep by the chimney.",
  reindeer: "The reindeer were hungry. Pip made a brand new friend.",
};
