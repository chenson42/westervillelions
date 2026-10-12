"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RemapResponse, SyncResponse } from "@/lib/santas-workshop/admin-contract";
import {
  ADMIN_API,
  callAdmin,
  formatEasternInstant,
  remapSummary,
  runRemapLoop,
  runSyncLoop,
  syncProgressText,
  syncSummary,
  type SyncProgress,
} from "@/lib/santas-workshop/admin-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "./styles";

interface Props {
  sessionId: string;
  campaignConnected: boolean;
  apiKeySet: boolean;
  lastSyncAt: string | null;
}

type Result = { tone: "ok" | "error"; text: string };

export function SyncPanel({ sessionId, campaignConnected, apiKeySet, lastSyncAt }: Props) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [remapping, setRemapping] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const stop = useRef(false);

  const syncBlocked = !campaignConnected || !apiKeySet;

  async function sync() {
    stop.current = false;
    setSyncing(true);
    setResult(null);
    const out = await runSyncLoop({
      post: (cursor) => callAdmin<SyncResponse>(ADMIN_API.sync(sessionId), { method: "POST", body: JSON.stringify({ cursor }) }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onProgress: setProgress,
      shouldStop: () => stop.current,
    });
    setSyncing(false);
    setProgress(null);
    if (out.status === "done") {
      setResult({ tone: "ok", text: syncSummary(out.counts) });
      toast.success("Sync finished.");
    } else if (out.status === "stopped") {
      setResult({ tone: "ok", text: "Sync stopped. Anything already read was kept. Run it again to finish." });
    } else {
      setResult({ tone: "error", text: `${out.failure.message} Nothing already read was lost: run Sync again.` });
    }
    router.refresh();
  }

  async function remap() {
    setRemapping(true);
    setResult(null);
    const out = await runRemapLoop({
      post: (cursor) => callAdmin<RemapResponse>(ADMIN_API.remap(sessionId), { method: "POST", body: JSON.stringify({ cursor }) }),
    });
    setRemapping(false);
    if (out.status === "error") {
      setResult({ tone: "error", text: `${out.failure.message} ${remapSummary(out.processed, out.changed)}` });
    } else {
      setResult({ tone: "ok", text: remapSummary(out.processed, out.changed) });
      toast.success("Registrants re-read.");
    }
    router.refresh();
  }

  return (
    <section className={`${CARD} p-6`} aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="text-lg font-semibold text-gray-900">3. Keep registrations in step</h2>
      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold text-gray-900">Sync from Zeffy</h3>
          <p className="mt-1 text-sm text-gray-600">
            Registrations normally arrive on their own. Sync asks Zeffy for everything it has and adds what the live feed missed. Run it on
            drop-off morning, and whenever the last event looks old.
          </p>
          <p className="mt-2 text-sm text-gray-500">Last Sync: {formatEasternInstant(lastSyncAt)}</p>
          {!campaignConnected && <p className="mt-2 text-sm text-amber-800">Connect a Zeffy form first.</p>}
          {campaignConnected && !apiKeySet && <p className="mt-2 text-sm text-amber-800">The Zeffy API key is not set on this server, so Sync cannot run.</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={BTN_PRIMARY} onClick={sync} disabled={syncBlocked || syncing || remapping}>
              {syncing ? "Syncing…" : "Sync from Zeffy"}
            </button>
            {syncing && (
              <button type="button" className={BTN_SECONDARY} onClick={() => (stop.current = true)}>
                Stop
              </button>
            )}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Remap</h3>
          <p className="mt-1 text-sm text-gray-600">
            Re-reads the answers already saved using the current question matches. It does not contact Zeffy and never changes a
            volunteer&rsquo;s work, only what was typed by buyers.
          </p>
          <div className="mt-3">
            <button type="button" className={BTN_SECONDARY} onClick={remap} disabled={syncing || remapping}>
              {remapping ? "Re-reading…" : "Remap registrants"}
            </button>
          </div>
        </div>
      </div>

      <div aria-live="polite" role="status" className="mt-4">
        {progress && <p className="rounded-lg bg-lions-blue/5 p-4 text-sm text-gray-800">{syncProgressText(progress)}</p>}
      </div>
      {result && (
        <p role={result.tone === "error" ? "alert" : "status"} className={`mt-2 rounded-lg p-4 text-sm ${result.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
