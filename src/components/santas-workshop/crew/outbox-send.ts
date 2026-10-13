/**
 * Browser glue for the outbox: builds the multipart upload for one queued photo,
 * sends it and classifies the answer. Not pure (fetch, FormData); the decision
 * logic lives in outbox-classify.ts and outbox-core.ts.
 */

import { SW_ATTEMPT_HEADER, type PhotoKind } from "@/lib/santas-workshop/crew-contract";
import { crewFetch, crewPaths } from "./crew-api";
import type { CrewAction } from "./crew-messages";
import { classifyUpload } from "./outbox-classify";
import type { OutboxItem, SendOutcome } from "./outbox-core";

function targetFor(slug: string, item: OutboxItem): { url: string; action: CrewAction } {
  const paths = crewPaths(slug);
  const byKind: Record<PhotoKind, () => { url: string; action: CrewAction }> = {
    check_in: () => ({ url: paths.checkIn(item.stuffyId ?? ""), action: "check_in" }),
    portrait: () => ({ url: paths.portrait(item.stuffyId ?? ""), action: "portrait" }),
    group: () => ({ url: paths.groupPhotos, action: "group_photo" }),
  };
  return byKind[item.kind]();
}

export function sendQueuedPhoto(slug: string) {
  return async (item: OutboxItem, attempt: number): Promise<SendOutcome> => {
    const { url, action } = targetFor(slug, item);
    const form = new FormData();
    form.set("meta", JSON.stringify(item.meta));
    form.set("full", item.full, `${item.photoId}.jpg`);
    if (item.thumb) form.set("thumb", item.thumb, `${item.photoId}-thumb.jpg`);
    const res = await crewFetch<unknown>(url, { method: "POST", body: form, headers: { [SW_ATTEMPT_HEADER]: String(attempt) } });
    return classifyUpload(res.ok ? { ok: true } : res, action);
  };
}
