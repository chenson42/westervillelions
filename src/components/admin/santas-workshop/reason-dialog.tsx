"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState } from "react";
import { BTN_PRIMARY, BTN_SMALL, INPUT, LABEL } from "./styles";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  reasonLabel?: string;
  confirmLabel: string;
  /** Extra controls above the reason (a state picker). */
  children?: React.ReactNode;
  /** Runs with the reason; return an error sentence to keep the dialog open, or null to close it. */
  onSubmit: (reason: string) => Promise<string | null>;
  minLength?: number;
}

/** A shadcn-style Dialog that asks for a short reason (kept in the history) before an action. */
export function ReasonDialog({ open, onOpenChange, title, description, reasonLabel = "Why? (kept in the history)", confirmLabel, children, onSubmit, minLength = 3 }: Props) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < minLength) {
      setError(`Please write a few words (at least ${minLength} letters).`);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSubmit(trimmed);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          setReason("");
        }
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold text-gray-900">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">{description}</Dialog.Description>
          <form onSubmit={submit} className="mt-4 space-y-4">
            {children}
            <div>
              <label htmlFor={id} className={LABEL}>
                {reasonLabel}
              </label>
              <textarea id={id} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Dialog.Close className={BTN_SMALL} type="button">
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy} className={BTN_PRIMARY}>
                {busy ? "Saving…" : confirmLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
