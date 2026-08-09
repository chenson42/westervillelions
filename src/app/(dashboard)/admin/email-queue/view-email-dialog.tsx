"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export type QueuedEmailStatus = "pending" | "sent" | "failed" | "blocked_non_production";

const STATUS_LABEL: Record<QueuedEmailStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  blocked_non_production: "Blocked (not production)",
};

const STATUS_CLASS: Record<QueuedEmailStatus, string> = {
  pending: "bg-gray-100 text-gray-700",
  sent: "bg-green-100 text-green-800",
  failed: "bg-amber-100 text-amber-800",
  blocked_non_production: "bg-lions-blue/10 text-lions-blue",
};

/** Small status pill shared by the queue tables and the preview dialog. */
export function StatusPill({ status }: { status: string }) {
  const known = (status in STATUS_LABEL ? status : "pending") as QueuedEmailStatus;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[known]}`}
    >
      {status in STATUS_LABEL ? STATUS_LABEL[known] : status}
    </span>
  );
}

interface ViewEmailDialogProps {
  to: string;
  subject: string;
  status: string;
  createdAtLabel: string;
  html: string;
}

/**
 * Preview a queued email's rendered HTML. The HTML is app-generated today, but this is a
 * general admin table, not a trusted-content pipeline — render it in a sandboxed iframe
 * (no `allow-scripts`) rather than `dangerouslySetInnerHTML`, so stored HTML can never run
 * script or reach into the admin page's DOM. Email HTML also carries its own inline styles
 * and full-document structure, which an iframe isolates correctly regardless.
 */
export function ViewEmailDialog({ to, subject, status, createdAtLabel, html }: ViewEmailDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          View
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 focus:outline-none max-h-[85vh] flex flex-col">
          <div className="flex items-start justify-between gap-4 mb-1">
            <Dialog.Title className="text-lg font-semibold text-gray-900 break-words">
              {subject}
            </Dialog.Title>
            <Dialog.Close
              className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 mb-4">
              <span>
                To: <span className="text-gray-700">{to}</span>
              </span>
              <StatusPill status={status} />
              <span>Queued {createdAtLabel}</span>
            </div>
          </Dialog.Description>

          <div className="flex-1 min-h-0 rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
            {/* Sandboxed with no `allow-scripts` — stored HTML is rendered inert, never trusted. */}
            <iframe
              sandbox=""
              srcDoc={html}
              title={`Rendered preview: ${subject}`}
              className="w-full h-full min-h-[50vh] bg-white"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
