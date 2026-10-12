"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConnectCampaignResponse, SyncResponse, ZeffyCampaignDto, ZeffyCampaignsResponse } from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin, connectSuccessNote, formatMoney, runSyncLoop, syncProgressText, syncSummary, type AdminFailure } from "@/lib/santas-workshop/admin-ui";
import { validateConnectCampaign } from "@/lib/santas-workshop/session-input";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL } from "./styles";

interface Props {
  sessionId: string;
  connected: { campaignId: string | null; campaignTitle: string | null; ticketRateIds: string[] };
  apiKeySet: boolean;
  /** True once any registrant exists: changing the form then affects live data. */
  hasRegistrants: boolean;
}

interface Choice {
  campaignId: string;
  title: string;
  rateIds: string[];
  /** Typed by hand, so Zeffy was not asked to confirm it. */
  manual: boolean;
}

export function ConnectPanel({ sessionId, connected, apiKeySet, hasRegistrants }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<ZeffyCampaignDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<AdminFailure | null>(null);
  const [pickedId, setPickedId] = useState<string>(connected.campaignId ?? "");
  const [rates, setRates] = useState<string[]>(connected.ticketRateIds);
  const [manualId, setManualId] = useState("");
  const [manualRates, setManualRates] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [offerSync, setOfferSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncText, setSyncText] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const picked = campaigns?.find((c) => c.id === pickedId) ?? null;

  async function findForms() {
    setLoading(true);
    setLoadError(null);
    const res = await callAdmin<ZeffyCampaignsResponse>(ADMIN_API.campaigns);
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.failure);
      return;
    }
    setCampaigns(res.data.campaigns);
  }

  function pickCampaign(c: ZeffyCampaignDto) {
    setPickedId(c.id);
    // Keep earlier choices only when they are rates of this very form.
    setRates((r) => r.filter((id) => c.rates.some((x) => x.id === id)));
  }

  function toggleRate(id: string) {
    setRates((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  function reviewPicked() {
    setFormError(null);
    if (!picked) return;
    if (rates.length === 0) {
      setFormError("Mark at least one ticket rate as the stuffy ticket. Without one, nothing will be registered.");
      return;
    }
    setChoice({ campaignId: picked.id, title: picked.title, rateIds: rates, manual: false });
  }

  function reviewManual() {
    setFormError(null);
    const ids = manualRates.split(/[\s,]+/).filter(Boolean);
    const checked = validateConnectCampaign({ campaignId: manualId.trim(), ticketRateIds: ids, campaignTitle: manualTitle });
    if (!checked.ok) {
      setFormError(checked.error);
      return;
    }
    if (ids.length === 0) {
      setFormError("Enter at least one ticket rate id.");
      return;
    }
    setChoice({ campaignId: checked.value.campaignId, title: checked.value.campaignTitle ?? checked.value.campaignId, rateIds: ids, manual: true });
  }

  async function confirm() {
    if (!choice) return;
    setSaving(true);
    setNotice(null);
    const res = await callAdmin<ConnectCampaignResponse>(ADMIN_API.connect(sessionId), {
      method: "PUT",
      body: JSON.stringify({ campaignId: choice.campaignId, ticketRateIds: choice.rateIds, campaignTitle: choice.manual ? choice.title : undefined }),
    });
    setSaving(false);
    if (!res.ok) {
      setNotice({ tone: "error", text: res.failure.message });
      return;
    }
    const note = connectSuccessNote(res.data.verified, apiKeySet);
    if (res.data.verified) toast.success("Zeffy form connected.");
    setNotice({ tone: res.data.verified ? "ok" : "warn", text: note.text });
    setOfferSync(note.offerSync);
    setSyncText(null);
    setChoice(null);
    router.refresh();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncText(null);
    const out = await runSyncLoop({
      post: (cursor) => callAdmin<SyncResponse>(ADMIN_API.sync(sessionId), { method: "POST", body: JSON.stringify({ cursor }) }),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onProgress: (p) => setSyncText({ tone: "ok", text: syncProgressText(p) }),
    });
    setSyncing(false);
    if (out.status === "done") {
      setSyncText({ tone: "ok", text: syncSummary(out.counts) });
      setOfferSync(false);
    } else if (out.status === "error") {
      setSyncText({ tone: "error", text: `${out.failure.message} Nothing already read was lost: run Sync again.` });
    }
    router.refresh();
  }

  const isConnected = Boolean(connected.campaignId);

  return (
    <section className={`${CARD} p-6`} aria-labelledby="connect-heading">
      <h2 id="connect-heading" className="text-lg font-semibold text-gray-900">1. Zeffy form</h2>

      {isConnected ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Connected form</dt>
            <dd className="font-medium text-gray-900 break-words">{connected.campaignTitle ?? "Untitled form"}</dd>
            <dd className="text-gray-500 break-all">Id: {connected.campaignId}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Stuffy ticket rates marked</dt>
            <dd className="font-medium text-gray-900">{connected.ticketRateIds.length}</dd>
            <dd className="text-gray-500 break-all">{connected.ticketRateIds.join(", ") || "none"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No form is connected yet. Registrations cannot arrive until one is.</p>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-4 rounded-lg p-4 text-sm ${notice.tone === "ok" ? "bg-green-50 text-green-800" : notice.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}
        >
          {notice.text}
        </p>
      )}
      {offerSync && (
        <div className="mt-3">
          <button type="button" className={BTN_PRIMARY} onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Run Sync now"}
          </button>
        </div>
      )}
      {syncText && (
        <p role={syncText.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-lg p-4 text-sm ${syncText.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {syncText.text}
        </p>
      )}

      <div className="mt-6 border-t border-gray-100 pt-6 space-y-4">
        <h3 className="font-semibold text-gray-900">{isConnected ? "Connect a different form" : "Choose the form"}</h3>

        {!apiKeySet && (
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            The Zeffy API key is not set on this server, so the form list cannot be loaded. Enter the form&rsquo;s id and rate ids by hand below, and set the key to let Sync run.
          </p>
        )}

        {apiKeySet && (
          <div>
            <button type="button" className={BTN_SECONDARY} onClick={findForms} disabled={loading}>
              {loading ? "Asking Zeffy…" : campaigns ? "Refresh the list" : "Find forms in Zeffy"}
            </button>
            {loadError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">{loadError.message}</p>}
          </div>
        )}

        {campaigns && campaigns.length === 0 && (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">Zeffy listed no forms for this account.</p>
            <p className="mt-1 text-sm">Create the ticket form in Zeffy first, or enter its id by hand below.</p>
          </div>
        )}

        {campaigns && campaigns.length > 0 && (
          <fieldset>
            <legend className={LABEL}>Zeffy forms</legend>
            <ul className="space-y-3">
              {campaigns.map((c) => {
                const takenElsewhere = c.connectedSessionId !== null && c.connectedSessionId !== sessionId;
                return (
                  <li key={c.id} className={`rounded-2xl border-2 p-4 ${pickedId === c.id ? "border-lions-blue bg-lions-blue/5" : "border-gray-200"}`}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="campaign"
                        className="mt-1 h-5 w-5"
                        checked={pickedId === c.id}
                        disabled={takenElsewhere}
                        onChange={() => pickCampaign(c)}
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900 break-words">{c.title}</span>
                        <span className="block text-sm text-gray-500">
                          {[c.type, c.status].filter(Boolean).join(" · ") || "Form"}
                          {takenElsewhere ? " · already connected to another session" : ""}
                        </span>
                      </span>
                    </label>
                    {pickedId === c.id && !takenElsewhere && (
                      <div className="mt-3 pl-8">
                        <p className="text-sm font-medium text-gray-700">Which ticket is the stuffy visit?</p>
                        {c.rates.length === 0 ? (
                          <p className="mt-1 text-sm text-gray-500">This form lists no ticket rates.</p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {c.rates.map((r) => (
                              <li key={r.id}>
                                <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                                  <input type="checkbox" className="h-5 w-5" checked={rates.includes(r.id)} onChange={() => toggleRate(r.id)} />
                                  <span className="text-sm text-gray-900 break-words">
                                    {r.title} <span className="text-gray-500">({formatMoney(r.amountCents)})</span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className={`${BTN_PRIMARY} mt-4`} disabled={!picked} onClick={reviewPicked}>
              Connect this form
            </button>
          </fieldset>
        )}

        <details className="rounded-2xl border border-gray-200 p-4" open={!apiKeySet}>
          <summary className="cursor-pointer min-h-[44px] flex items-center font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
            Enter the form by hand
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="manual-id" className={LABEL}>Zeffy form id</label>
              <input id="manual-id" className={INPUT} value={manualId} onChange={(e) => setManualId(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="manual-rates" className={LABEL}>Stuffy ticket rate ids</label>
              <input id="manual-rates" className={INPUT} value={manualRates} onChange={(e) => setManualRates(e.target.value)} autoComplete="off" aria-describedby="manual-rates-help" />
              <p id="manual-rates-help" className="mt-1 text-sm text-gray-500">Separate several with commas.</p>
            </div>
            <div>
              <label htmlFor="manual-title" className={LABEL}>Form title (optional)</label>
              <input id="manual-title" className={INPUT} value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} maxLength={200} />
            </div>
            <button type="button" className={BTN_SECONDARY} onClick={reviewManual}>Connect this form</button>
          </div>
        </details>

        {formError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{formError}</p>}
      </div>

      <ConfirmDialog
        open={choice !== null}
        onOpenChange={(o) => {
          if (!o && !saving) setChoice(null);
        }}
        title={`Connect “${choice?.title ?? ""}”?`}
        description={
          <>
            <p>Registrations from this Zeffy form will be added to this session, and only this form&rsquo;s tickets marked as the stuffy visit will count.</p>
            {choice?.manual && <p className="mt-2">You typed this form in by hand, so it will be saved without Zeffy checking it.</p>}
            {isConnected && connected.campaignId !== choice?.campaignId && (
              <p className="mt-2 font-medium text-amber-800">
                {hasRegistrants
                  ? "This session already has registrants from the current form. They stay, but new ones will come from the new form."
                  : "This replaces the form currently connected."}
              </p>
            )}
          </>
        }
        confirmLabel="Connect form"
        onConfirm={confirm}
      />
    </section>
  );
}
