"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { QuestionsResponse, RemapResponse, SaveQuestionMapResponse } from "@/lib/santas-workshop/admin-contract";
import {
  ADMIN_API,
  IGNORE_OPTION,
  assignQuestion,
  attentionWouldChangeText,
  callAdmin,
  fieldOfQuestion,
  mapsEqual,
  remapSummary,
  runRemapLoop,
  type QuestionMapState,
} from "@/lib/santas-workshop/admin-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EMPTY } from "./styles";

interface Props {
  sessionId: string;
  initial: QuestionsResponse;
  campaignConnected: boolean;
}

export function QuestionMapEditor({ sessionId, initial, campaignConnected }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<QuestionMapState>(initial.map);
  const [draft, setDraft] = useState<QuestionMapState>(initial.map);
  const [busy, setBusy] = useState<"save" | "remap" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [changedAfterSave, setChangedAfterSave] = useState<number | null>(null);

  const dirty = !mapsEqual(saved, draft);
  const unassigned = initial.questions.filter((q) => !fieldOfQuestion(draft, q.text)).length;

  async function save(): Promise<boolean> {
    setBusy("save");
    setMessage(null);
    const res = await callAdmin<SaveQuestionMapResponse>(ADMIN_API.questionMap(sessionId), {
      method: "PUT",
      body: JSON.stringify({ map: draft }),
    });
    setBusy(null);
    if (!res.ok) {
      setMessage({ tone: "error", text: res.failure.message });
      return false;
    }
    setSaved(draft);
    setChangedAfterSave(res.data.attentionWouldChange);
    setMessage({ tone: "ok", text: attentionWouldChangeText(res.data.attentionWouldChange) });
    toast.success("Question map saved.");
    return true;
  }

  async function remap() {
    setBusy("remap");
    setMessage(null);
    const out = await runRemapLoop({
      post: (cursor) => callAdmin<RemapResponse>(ADMIN_API.remap(sessionId), { method: "POST", body: JSON.stringify({ cursor }) }),
    });
    setBusy(null);
    if (out.status === "error") {
      setMessage({ tone: "error", text: `${out.failure.message} ${remapSummary(out.processed, out.changed)}` });
    } else {
      setMessage({ tone: "ok", text: remapSummary(out.processed, out.changed) });
      setChangedAfterSave(null);
      toast.success("Registrants re-read.");
    }
    router.refresh();
  }

  async function saveAndRemap() {
    if (await save()) await remap();
  }

  return (
    <section className={`${CARD} p-6`} aria-labelledby="map-heading">
      <h2 id="map-heading" className="text-lg font-semibold text-gray-900">2. Match the form&rsquo;s questions</h2>
      <p className="mt-2 text-sm text-gray-600">
        Each question Zeffy sent shows up here once a registration has arrived. Say which field it fills, or mark it
        &ldquo;Ignore&rdquo; if the club does not need it. Registrants with a question that is neither matched nor ignored stay flagged
        for attention.
      </p>

      {!campaignConnected && (
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Connect a Zeffy form first. Questions can only be seen once registrations from it arrive.</p>
      )}

      {initial.questions.length === 0 ? (
        <div className={`${EMPTY} mt-4`}>
          <p className="font-medium">No questions seen yet.</p>
          <p className="mt-1 text-sm">Make a test purchase on the practice form, or run Sync, and the questions will appear here.</p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-gray-700" role="status">
            {unassigned === 0 ? "Every question is matched or ignored." : `${unassigned} question${unassigned === 1 ? "" : "s"} not matched yet.`}
          </p>
          <ul className="mt-3 divide-y divide-gray-100">
            {initial.questions.map((q) => {
              const field = fieldOfQuestion(draft, q.text) ?? "";
              const selectId = `qmap-${q.text.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`;
              return (
                <li key={q.text} className="py-4 grid gap-2 md:grid-cols-[1fr_16rem] md:items-center md:gap-4">
                  <div className="min-w-0">
                    {/* Zeffy text is untrusted: rendered as a plain React text node only. */}
                    <p className="font-medium text-gray-900 break-words">{q.example}</p>
                    <p className="text-sm text-gray-500">
                      {q.type ? `${q.type} · ` : ""}
                      {q.count === 0 ? "not seen in any registration" : `seen ${q.count} time${q.count === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <div>
                    <label htmlFor={selectId} className="sr-only">
                      Field for the question {q.example}
                    </label>
                    <select
                      id={selectId}
                      value={field}
                      onChange={(e) => setDraft((d) => assignQuestion(d, q.text, e.target.value || null))}
                      className="block w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                    >
                      <option value="">Not matched yet</option>
                      {initial.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                          {f.required ? " (required)" : ""} · {f.scope === "ticket" ? "per stuffy" : "per order"}
                        </option>
                      ))}
                      <option value={IGNORE_OPTION}>Ignore: the club does not need this</option>
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-4 rounded-lg p-4 text-sm ${message.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={!dirty || busy !== null} onClick={saveAndRemap}>
          {busy === "save" ? "Saving…" : busy === "remap" ? "Re-reading…" : "Save and re-read registrants"}
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={!dirty || busy !== null} onClick={save}>
          Save only
        </button>
        {!dirty && changedAfterSave !== null && changedAfterSave > 0 && (
          <button type="button" className={BTN_SECONDARY} disabled={busy !== null} onClick={remap}>
            Re-read registrants now
          </button>
        )}
      </div>
    </section>
  );
}
