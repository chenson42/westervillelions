/**
 * The go-live checklist on the session page (Phase 1 addendum, Flow A: "setup
 * order is a go-live gate"). Pure: the query layer gathers facts, this turns
 * them into items. Webhook death is SILENT, so the checklist makes it visible:
 * the last event time, an amber state when registrants exist but nothing has
 * arrived in 24 hours, and the Friday-morning Sync item.
 */

import { easternDateString } from "@/lib/eastern-date";
import { QUESTION_FIELDS } from "./question-fields";
import type { ChecklistItem } from "./admin-contract";

export interface ChecklistFacts {
  now: Date;
  campaignConnected: boolean;
  ticketRateCount: number;
  /** Keys of the REQUIRED fields that no question string maps to. */
  unmappedRequiredFields: string[];
  webhookSecretSet: boolean;
  apiKeySet: boolean;
  orderCount: number;
  lastCampaignEventAt: Date | null;
  lastAnyEventAt: Date | null;
  lastSyncAt: Date | null;
  /** Eastern "YYYY-MM-DD". */
  dropoffDate: string;
  /** False when the photo store cannot be built (production without Drive credentials). */
  storageConfigured: boolean;
  /** The newest storage test on any session, or null. */
  lastStorageTest: { at: Date; ok: boolean } | null;
  workerCodeIssued: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function requiredFieldLabel(key: string): string {
  return QUESTION_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function buildChecklist(f: ChecklistFacts): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const today = easternDateString(f.now);

  items.push({
    key: "campaign_connected",
    label: "Zeffy form connected",
    state: f.campaignConnected ? "done" : "todo",
    ...(f.campaignConnected ? {} : { detail: "Pick the session's Zeffy ticket form on the Connect page." }),
  });

  items.push({
    key: "ticket_rates",
    label: "Stuffy ticket rates marked",
    state: f.ticketRateCount > 0 ? "done" : "todo",
    detail: f.ticketRateCount > 0 ? `${f.ticketRateCount} marked` : "No stuffy rate marked: nothing will be registered.",
  });

  items.push({
    key: "fields_mapped",
    label: "Required questions mapped",
    state: f.unmappedRequiredFields.length === 0 ? "done" : "todo",
    ...(f.unmappedRequiredFields.length === 0
      ? {}
      : { detail: `Not yet mapped: ${f.unmappedRequiredFields.map(requiredFieldLabel).join(", ")}.` }),
  });

  const configured = f.webhookSecretSet && f.apiKeySet;
  items.push({
    key: "zeffy_configured",
    label: "Webhook secret and API key set",
    state: configured ? "done" : "todo",
    ...(configured
      ? {}
      : {
          detail: `Missing: ${[!f.webhookSecretSet && "webhook secret", !f.apiKeySet && "API key"].filter(Boolean).join(" and ")}.`,
        }),
  });

  // Last valid event: amber when registrants exist but the form has been quiet for a day.
  const quiet = !f.lastCampaignEventAt || f.now.getTime() - f.lastCampaignEventAt.getTime() > DAY_MS;
  if (!f.lastCampaignEventAt) {
    items.push({
      key: "last_event",
      label: "Last Zeffy event",
      state: f.orderCount > 0 && today < f.dropoffDate ? "warn" : "todo",
      detail:
        f.orderCount > 0
          ? "No Zeffy event is logged for this form, yet registrants exist. Run Sync."
          : "No event received yet. Make a test purchase on the practice form.",
    });
  } else {
    items.push({
      key: "last_event",
      label: "Last Zeffy event",
      state: quiet && f.orderCount > 0 && today < f.dropoffDate ? "warn" : "done",
      ...(quiet && f.orderCount > 0 && today < f.dropoffDate
        ? { detail: "No event in over 24 hours. Run Sync to check for missed registrations." }
        : {}),
    });
  }

  const test = f.lastStorageTest;
  items.push({
    key: "storage_tested",
    label: "Photo storage tested",
    state: !f.storageConfigured ? "todo" : test ? (test.ok ? "done" : "warn") : "todo",
    detail: !f.storageConfigured
      ? "Photo storage is not configured on this deployment."
      : test
        ? test.ok
          ? "The last storage test passed."
          : "The last storage test failed. Run it again before opening the doors."
        : "Run Test storage before the first photo is taken.",
  });
  items.push({
    key: "worker_code",
    label: "Worker code issued",
    state: f.workerCodeIssued ? "done" : "todo",
    ...(f.workerCodeIssued ? {} : { detail: "Activating the session issues the worker code." }),
  });

  const syncedOnDropoff = f.lastSyncAt !== null && easternDateString(f.lastSyncAt) >= f.dropoffDate;
  items.push({
    key: "friday_sync",
    label: "Drop-off morning Sync",
    state: syncedOnDropoff ? "done" : today >= f.dropoffDate ? "todo" : "info",
    detail: syncedOnDropoff
      ? "Synced on or after drop-off day."
      : today >= f.dropoffDate
        ? "Run Sync from Zeffy before the doors open: a dead webhook is silent."
        : "On drop-off morning, run Sync from Zeffy.",
  });

  return items;
}

/** Required field keys that have no mapped question string. */
export function unmappedRequiredFields(map: Partial<Record<string, string[]>>): string[] {
  return QUESTION_FIELDS.filter((f) => f.required && !(map[f.key]?.length ?? 0)).map((f) => f.key);
}
