/**
 * Response helpers shared by the /api/admin/santas-workshop/** handlers.
 *
 * Every response carries `Cache-Control: no-store` (parent contact data) and the
 * `{ error, code, field? }` envelope of admin-contract.ts. The auth + feature
 * gate itself is deliberately NOT here: each route file spells out
 * `await auth()` then `hasFeature(..., FEATURES.SANTAS_WORKSHOP_MANAGE)` in its
 * own body, because admin-routes-gate.test.ts scans for exactly that.
 */

import { NextResponse } from "next/server";
import { ZeffyError } from "@/lib/zeffy/client";
import type { AdminErrorBody, AdminErrorCode } from "./admin-contract";
import type { QueryFailure } from "./session-queries";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function ok<T>(body: T, status: 200 | 201 = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function adminError(status: number, code: AdminErrorCode, error: string, field?: string): NextResponse {
  const body: AdminErrorBody = { error, code, ...(field ? { field } : {}) };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export const unauthorized = () => adminError(401, "unauthorized", "Unauthorized");
export const forbidden = () => adminError(403, "forbidden", "Forbidden");
export const notFound = (what = "Not found") => adminError(404, "not_found", what);

export function fromFailure(f: QueryFailure): NextResponse {
  return adminError(f.status, f.code, f.error, f.field);
}

/** The route's JSON body, or null when it is missing or not valid JSON. Call only AFTER the gate. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function zeffyFailure(e: ZeffyError): NextResponse {
  switch (e.code) {
    case "not_configured":
      return adminError(503, "zeffy_not_configured", "The Zeffy API key is not configured");
    case "rate_limited":
      return adminError(503, "zeffy_rate_limited", "Zeffy is limiting requests; try again shortly");
    case "dev_campaign_not_allowed":
      return adminError(400, "invalid_input", "That campaign is not on this environment's allowlist");
    default:
      return adminError(502, "zeffy_unavailable", "Zeffy could not be reached");
  }
}

/** Logs a failure by name and database code only: a driver message can carry query parameters (personal data). */
export function logRouteError(label: string, error: unknown): void {
  const e = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  console.error(`santas-workshop ${label} failed`, { name: e?.name ?? "Error", code: e?.code ?? e?.cause?.code ?? null });
}

export function serverError(label: string, error: unknown): NextResponse {
  logRouteError(label, error);
  return adminError(500, "server_error", "Something went wrong");
}
