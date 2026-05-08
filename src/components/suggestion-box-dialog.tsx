"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";

const CATEGORIES = [
  "Club Activity Idea",
  "Website Improvement",
  "Portal Improvement",
  "Other",
] as const;

interface SuggestionBoxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SuggestionBoxDialog({ open, onOpenChange }: SuggestionBoxDialogProps) {
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCategory(CATEGORIES[0]);
    setMessage("");
    setIsAnonymous(false);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length === 0) {
      toast.error("Please enter your suggestion before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, isAnonymous }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to submit suggestion.");
      }
      toast.success("Thanks! Your suggestion has been sent.");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit suggestion.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-xl font-semibold text-gray-900">
            Suggestion Box
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            Share an idea for a club activity, or a tweak to the website or portal. The board will review every submission.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="suggestion-category" className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                id="suggestion-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue/30 disabled:opacity-50"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="suggestion-message" className="block text-sm font-medium text-gray-700 mb-1">
                Your suggestion
              </label>
              <textarea
                id="suggestion-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={submitting}
                rows={6}
                maxLength={5000}
                placeholder="Tell us your idea…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue/30 disabled:opacity-50"
                required
              />
              <p className="mt-1 text-xs text-gray-400 text-right">{message.length}/5000</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-lions-blue focus:ring-lions-blue"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-900">Submit anonymously</span>
                <span className="block text-gray-500">
                  Your name and email won&apos;t be included in the email sent to the board.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close
                type="button"
                disabled={submitting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark transition disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send suggestion"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
