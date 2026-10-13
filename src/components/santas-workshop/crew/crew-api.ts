/**
 * Thin client for /api/santas-workshop/crew/[slug]/**: path builders and one
 * fetch wrapper that never throws and returns the typed error body of the crew
 * contract. Request and response TYPES come from crew-contract.ts, never
 * redefined here. Client-safe (the fetch implementation is injectable for tests).
 */

import type { CrewErrorBody } from "@/lib/santas-workshop/crew-contract";
import { isCrewErrorCode } from "./crew-messages";

const enc = encodeURIComponent;

export function crewPaths(slug: string) {
  const base = `/api/santas-workshop/crew/${enc(slug)}`;
  return {
    enter: `${base}/enter`,
    roster: `${base}/roster`,
    search: (q: string) => `${base}/search?q=${enc(q)}`,
    scan: `${base}/scan`,
    card: (id: string, view: string) => `${base}/stuffies/${enc(id)}?view=${enc(view)}`,
    tag: (id: string) => `${base}/stuffies/${enc(id)}/tag`,
    checkIn: (id: string) => `${base}/stuffies/${enc(id)}/check-in`,
    portrait: (id: string) => `${base}/stuffies/${enc(id)}/portrait`,
    pickupName: (id: string) => `${base}/stuffies/${enc(id)}/pickup-name`,
    pickupCheck: (id: string) => `${base}/stuffies/${enc(id)}/pickup-check`,
    pickup: (id: string) => `${base}/stuffies/${enc(id)}/pickup`,
    revert: (id: string) => `${base}/stuffies/${enc(id)}/revert`,
    groupPhotos: `${base}/group-photos`,
  } as const;
}

/** The photo door URL for a photo id (thumb or full). 404s uniformly when not allowed. */
export function photoUrl(photoId: string, variant: "thumb" | "full"): string {
  return `/api/santas-workshop/photos/${enc(photoId)}?v=${variant}`;
}

export type CrewCall<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; body: CrewErrorBody | null };

/** Accepts only a body whose `code` is in the contract's vocabulary; anything else is null (shown as a network-style failure). */
export function parseCrewErrorBody(value: unknown): CrewErrorBody | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { code?: unknown; error?: unknown };
  if (!isCrewErrorCode(v.code)) return null;
  return { ...(value as object), error: typeof v.error === "string" ? v.error : "" } as CrewErrorBody;
}

export async function crewFetch<T>(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CrewCall<T>> {
  try {
    const res = await fetchImpl(url, { credentials: "same-origin", cache: "no-store", ...init });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, body: parseCrewErrorBody(json) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export function postJson<T>(url: string, body: unknown, fetchImpl?: typeof fetch): Promise<CrewCall<T>> {
  return crewFetch<T>(
    url,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    fetchImpl,
  );
}

/** A fresh uuid for an idempotency key or photo id. */
export function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Insecure-context fallback (plain http on a LAN during a dry run): v4-shaped, from getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
