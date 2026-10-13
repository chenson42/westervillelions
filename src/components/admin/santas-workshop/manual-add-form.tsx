"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ManualAddRequest, RegistrantResponse, SessionWindow } from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import { validateManualAdd } from "@/lib/santas-workshop/manual-add";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, INPUT, LABEL } from "./styles";

interface Props {
  sessionId: string;
  windows: SessionWindow[];
  disabled?: boolean;
}

const EMPTY = { parentFirstName: "", parentLastName: "", stuffyName: "", description: "", windowId: "", snack: "", noteToSanta: "", careNote: "", parentEmail: "", parentPhone: "", photoConsent: false, reason: "" };

function newKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Phone-usable form for a registrant who did not come through Zeffy (a phone call, a paper sign-up). */
export function ManualAddForm({ sessionId, windows, disabled = false }: Props) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  // One key per form fill: a double tap on Add replays instead of adding twice.
  const [key, setKey] = useState(newKey);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const id = (n: string) => `${uid}-${n}`;
  const bad = (field: string) => (error?.field === field ? { "aria-invalid": true as const, "aria-describedby": id("err") } : {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body: ManualAddRequest = {
      parentFirstName: form.parentFirstName,
      parentLastName: form.parentLastName,
      stuffyName: form.stuffyName,
      windowId: form.windowId,
      reason: form.reason,
      idempotencyKey: key,
      description: form.description,
      snack: form.snack,
      noteToSanta: form.noteToSanta,
      careNote: form.careNote,
      parentEmail: form.parentEmail,
      parentPhone: form.parentPhone,
      photoConsent: form.photoConsent,
    };
    const check = validateManualAdd(body, windows);
    if (!check.ok) {
      setError({ message: check.error, field: check.field });
      return;
    }
    setBusy(true);
    setError(null);
    const res = await callAdmin<RegistrantResponse>(ADMIN_API.manualAdd(sessionId), { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError({ message: res.failure.message, field: res.failure.field });
      return;
    }
    toast.success("Added to the list.");
    setForm(EMPTY);
    setKey(newKey());
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={BTN_SECONDARY} disabled={disabled}>
          Add a registrant by hand
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold text-gray-900">Add a registrant by hand</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            For a family who signed up by phone or on paper. Only the family&rsquo;s name, the stuffy&rsquo;s name, a drop-off window and a reason are required.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={id("pf")} className={LABEL}>Parent first name</label>
                <input id={id("pf")} className={INPUT} value={form.parentFirstName} onChange={(e) => set("parentFirstName", e.target.value)} autoComplete="off" required {...bad("parentFirstName")} />
              </div>
              <div>
                <label htmlFor={id("pl")} className={LABEL}>Parent last name</label>
                <input id={id("pl")} className={INPUT} value={form.parentLastName} onChange={(e) => set("parentLastName", e.target.value)} autoComplete="off" required {...bad("parentLastName")} />
              </div>
            </div>
            <div>
              <label htmlFor={id("sn")} className={LABEL}>Stuffy&rsquo;s name</label>
              <input id={id("sn")} className={INPUT} value={form.stuffyName} onChange={(e) => set("stuffyName", e.target.value)} autoComplete="off" required {...bad("stuffyName")} />
            </div>
            <div>
              <label htmlFor={id("de")} className={LABEL}>What it is (optional)</label>
              <input id={id("de")} className={INPUT} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Brown bear with a red bow" {...bad("description")} />
            </div>
            <div>
              <label htmlFor={id("wi")} className={LABEL}>Drop-off window</label>
              <select id={id("wi")} className={INPUT} value={form.windowId} onChange={(e) => set("windowId", e.target.value)} required {...bad("windowId")}>
                <option value="">Choose a window</option>
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={id("sk")} className={LABEL}>Snack choice (optional)</label>
              <input id={id("sk")} className={INPUT} value={form.snack} onChange={(e) => set("snack", e.target.value)} {...bad("snack")} />
            </div>
            <div>
              <label htmlFor={id("ns")} className={LABEL}>Note to Santa (optional)</label>
              <textarea id={id("ns")} rows={2} className={INPUT} value={form.noteToSanta} onChange={(e) => set("noteToSanta", e.target.value)} {...bad("noteToSanta")} />
            </div>
            <div>
              <label htmlFor={id("cn")} className={LABEL}>Care note (optional)</label>
              <textarea id={id("cn")} rows={2} className={INPUT} value={form.careNote} onChange={(e) => set("careNote", e.target.value)} {...bad("careNote")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={id("em")} className={LABEL}>Parent email (optional)</label>
                <input id={id("em")} type="email" inputMode="email" className={INPUT} value={form.parentEmail} onChange={(e) => set("parentEmail", e.target.value)} autoComplete="off" {...bad("parentEmail")} />
              </div>
              <div>
                <label htmlFor={id("ph")} className={LABEL}>Parent phone (optional)</label>
                <input id={id("ph")} type="tel" inputMode="tel" className={INPUT} value={form.parentPhone} onChange={(e) => set("parentPhone", e.target.value)} autoComplete="off" {...bad("parentPhone")} />
              </div>
            </div>
            <div className="flex min-h-[44px] items-center gap-3">
              <input id={id("pc")} type="checkbox" className="h-5 w-5 rounded border-gray-300 text-lions-blue focus:ring-lions-blue" checked={form.photoConsent} onChange={(e) => set("photoConsent", e.target.checked)} />
              <label htmlFor={id("pc")} className="text-sm text-gray-800">The family agreed to share their stuffy&rsquo;s portrait on the public collage</label>
            </div>
            <div>
              <label htmlFor={id("re")} className={LABEL}>Why you are adding this by hand (kept in the history)</label>
              <textarea id={id("re")} rows={2} className={INPUT} value={form.reason} onChange={(e) => set("reason", e.target.value)} required {...bad("reason")} />
            </div>
            {error && (
              <p id={id("err")} role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {error.message}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Dialog.Close type="button" className={BTN_SMALL}>Cancel</Dialog.Close>
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>{busy ? "Adding…" : "Add to the list"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
