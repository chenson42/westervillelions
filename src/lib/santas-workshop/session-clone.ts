/**
 * Clone a session: the pure copy rules (client-safe, no DB).
 *
 * A clone is the ordinary "new session" form pre-filled from a source row, plus a
 * server-side copy of the few settings the form does not collect. Everything that
 * belongs to one RUN (worker code, collage token, Zeffy ids, storage folder, stamps,
 * people, photos) is never part of `CloneConfig`: the config is an explicit allowlist
 * and `session-clone-source.test.ts` pins that no credential or run identifier is read.
 *
 * Deliberately knows nothing about any other table: how a later step joins this
 * transaction is the caller's business, not this module's.
 */

import type { CreateSessionRequest, SessionWindow } from "./admin-contract";
import {
  DEFAULT_QUOTA_BYTES,
  QUOTA_MAX_BYTES,
  QUOTA_MIN_BYTES,
  defaultCrewClosesOn,
  defaultRetention,
  defaultSessionDraft,
  validateQuestionMap,
  validateSessionDates,
  validateUpdateSession,
} from "./session-input";
import type { SessionKind } from "./session-vocabulary";
import { suggestSlug } from "./admin-ui";

/** The only source columns a clone reads. Named, never `select *`. */
export interface CloneSource {
  id: string;
  slug: string;
  name: string;
  kind: SessionKind;
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  windows: SessionWindow[];
  crewClosesOn: string;
  purgePersonalOn: string;
  purgePublicOn: string;
  storageQuotaBytes: number;
  frameArtKey: string;
  framePartSize: number;
  questionMap: Record<string, string[]>;
}

/** The settings a clone copies or derives that the form does not collect. */
export interface CloneConfig {
  crewClosesOn: string;
  purgePersonalOn: string;
  purgePublicOn: string;
  storageQuotaBytes: number;
  frameFilePrefix: "";
  frameArtKey: string;
  framePartSize: number;
  questionMap: Record<string, string[]>;
}

export type CloneConfigResult = { ok: true; value: CloneConfig } | { ok: false; error: string };

const quotaInRange = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= QUOTA_MIN_BYTES && n <= QUOTA_MAX_BYTES;

/** Same kind copies the source quota (when valid); a different kind gets that kind's default. */
export function cloneQuotaBytes(sourceKind: SessionKind, sourceQuota: number, newKind: SessionKind): number {
  return sourceKind === newKind && quotaInRange(sourceQuota) ? sourceQuota : DEFAULT_QUOTA_BYTES[newKind];
}

export function cloneConfig(source: CloneSource, input: CreateSessionRequest): CloneConfigResult {
  const bad = "The source session's settings need fixing before it can be cloned";

  // Schedule: copy only while the pickup day has not moved; always keep a coherent set.
  const derived = { crewClosesOn: defaultCrewClosesOn(input.pickupDate), ...defaultRetention(input.pickupDate) };
  const copied = {
    crewClosesOn: source.crewClosesOn,
    purgePersonalOn: source.purgePersonalOn,
    purgePublicOn: source.purgePublicOn,
  };
  const dateBase = { dropoffDate: input.dropoffDate, photoDate: input.photoDate, pickupDate: input.pickupDate };
  const schedule =
    input.pickupDate === source.pickupDate && validateSessionDates({ ...dateBase, ...copied }).ok ? copied : derived;

  const art = validateUpdateSession({ frameArtKey: source.frameArtKey, framePartSize: source.framePartSize });
  if (!art.ok) return { ok: false, error: bad };
  const map = validateQuestionMap({ map: source.questionMap });
  if (!map.ok) return { ok: false, error: bad };

  return {
    ok: true,
    value: {
      ...schedule,
      storageQuotaBytes: cloneQuotaBytes(source.kind, source.storageQuotaBytes, input.kind),
      // Never copied: an empty prefix derives the file names from the NEW slug.
      frameFilePrefix: "",
      frameArtKey: art.value.frameArtKey as string,
      framePartSize: art.value.framePartSize as number,
      questionMap: map.value,
    },
  };
}

/** The form's starting values: dates and windows from the source, the default name for the kind. */
export function cloneDraft(source: CloneSource, kind: SessionKind = "practice"): CreateSessionRequest {
  return {
    ...defaultSessionDraft(kind),
    dropoffDate: source.dropoffDate,
    photoDate: source.photoDate,
    pickupDate: source.pickupDate,
    windows: source.windows.map((w) => ({ ...w })),
  };
}

/** A slug suggestion that is not the source's own (the common practice-to-practice collision). */
export function suggestCloneSlug(kind: SessionKind, dropoffDate: string, sourceSlug: string): string {
  const s = suggestSlug(kind, dropoffDate);
  return s === sourceSlug ? `${s}-2` : s;
}

/** Eastern day strings: equal is not past. */
export function isPastDay(day: string, today: string): boolean {
  return day < today;
}
