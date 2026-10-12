"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ReprocessResult, ZeffyEventDto } from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin, canReprocessOutcome, eventCodeSentence, formatEasternInstant, outcomeLabel } from "@/lib/santas-workshop/admin-ui";
import { Chip } from "./badges";
import { BTN_SMALL, CARD, EMPTY } from "./styles";

export function EventsList({ events, lastValidEventAt }: { events: ZeffyEventDto[]; lastValidEventAt: string | null }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function reprocess(id: string) {
    setBusyId(id);
    setMessage(null);
    const res = await callAdmin<ReprocessResult>(ADMIN_API.eventReprocess(id), { method: "POST", body: "{}" });
    setBusyId(null);
    if (!res.ok) {
      setMessage({ tone: "error", text: res.failure.message });
      return;
    }
    const label = outcomeLabel(res.data.outcome);
    setMessage({ tone: res.data.outcome === "failed" ? "error" : "ok", text: `Reprocessed: ${label}.` });
    if (res.data.outcome !== "failed") toast.success("Event reprocessed.");
    router.refresh();
  }

  return (
    <section className={`${CARD} p-6`} aria-labelledby="events-heading">
      <h2 id="events-heading" className="text-lg font-semibold text-gray-900">Recent Zeffy events</h2>
      <p className="mt-1 text-sm text-gray-600">Last event of any kind from Zeffy: {formatEasternInstant(lastValidEventAt)}.</p>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-lg p-4 text-sm ${message.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}

      {events.length === 0 ? (
        <div className={`${EMPTY} mt-4`}>
          <p className="font-medium">No events from this form yet.</p>
          <p className="mt-1 text-sm">Once someone buys a ticket, the notice from Zeffy shows up here.</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {events.map((e) => (
            <li key={e.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{formatEasternInstant(e.receivedAt)}</p>
                <p className="text-sm text-gray-500 break-all">
                  {e.type ?? "unknown type"}
                  {e.paymentId ? ` · ${e.paymentId}` : ""}
                  {e.attempts > 1 ? ` · ${e.attempts} attempts` : ""}
                </p>
                {e.errorCode && (
                  <>
                    <p className="mt-1 text-sm text-gray-800">{eventCodeSentence(e.errorCode)}</p>
                    <p className="text-xs text-gray-400 break-all">Code for support: {e.errorCode}</p>
                  </>
                )}
              </div>
              <Chip tone={e.outcome === "processed" ? "green" : e.outcome === "failed" || e.outcome === "invalid" ? "red" : "gray"}>
                {outcomeLabel(e.outcome)}
              </Chip>
              {canReprocessOutcome(e.outcome) && (e.hasPayload || e.outcome === "failed" || e.outcome === "received") && (
                <button type="button" className={BTN_SMALL} onClick={() => reprocess(e.id)} disabled={busyId !== null} aria-label={`Reprocess the event received ${formatEasternInstant(e.receivedAt)}`}>
                  {busyId === e.id ? "Reprocessing…" : "Reprocess"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
