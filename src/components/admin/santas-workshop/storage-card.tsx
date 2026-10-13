"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { StorageCheckAction, StorageCheckRequest, StorageCheckResponse, StorageStatus, StorageTestRequest, StorageTestResponse } from "@/lib/santas-workshop/admin-contract";
import { storageCheckText, storageModeText } from "@/lib/santas-workshop/admin-actions-ui";
import { ADMIN_API, callAdmin, formatEasternInstant } from "@/lib/santas-workshop/admin-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "./styles";

interface Props {
  sessionId: string;
  storage: StorageStatus;
  kind: "practice" | "real";
}

export function StorageCard({ sessionId, storage, kind }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"test" | "check" | "delete" | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [check, setCheck] = useState<StorageCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function runTest() {
    setBusy("test");
    setError(null);
    const body: StorageTestRequest = { sessionId };
    const res = await callAdmin<StorageTestResponse>(ADMIN_API.storageTest, { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) {
      setTest({ ok: false, text: res.failure.message });
      router.refresh();
      return;
    }
    setTest({ ok: true, text: `Photo storage works (${res.data.latencyMs} ms). A real session can be activated for the next 10 minutes.` });
    toast.success("Photo storage test passed.");
    router.refresh();
  }

  async function runCheck(action?: StorageCheckAction) {
    setBusy(action ? "delete" : "check");
    setError(null);
    const body: StorageCheckRequest = action ? { action } : {};
    const res = await callAdmin<StorageCheckResponse>(ADMIN_API.storageCheck(sessionId), { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    setCheck(res.data);
    if (action) toast.success(`${res.data.deleted} stray file${res.data.deleted === 1 ? "" : "s"} deleted.`);
    router.refresh();
  }

  return (
    <section className={`${CARD} p-6`} aria-labelledby="storage-heading">
      <h2 id="storage-heading" className="text-lg font-semibold text-gray-900">
        Photo storage
      </h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Photos are kept in</dt>
          <dd className="text-right font-medium text-gray-900">{storage.configured ? storageModeText(storage.mode) : "Not set up"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">Last test</dt>
          <dd className="text-right font-medium text-gray-900">
            {storage.lastTest ? `${storage.lastTest.ok ? "Passed" : "Failed"} ${formatEasternInstant(storage.lastTest.at)}` : "Never"}
          </dd>
        </div>
      </dl>
      {storage.bannerCause && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{storage.bannerCause}</p>}
      <p className="mt-3 text-sm text-gray-600">
        {kind === "real" ? "A real session can only be activated after a passing test in the last 10 minutes." : "A practice session does not need a passing test."}
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={busy !== null} onClick={() => void runTest()}>
          {busy === "test" ? "Testing…" : "Test storage"}
        </button>
        <button type="button" className={BTN_SECONDARY} disabled={busy !== null} onClick={() => void runCheck()}>
          {busy === "check" ? "Checking…" : "Check storage"}
        </button>
      </div>

      {test && (
        <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${test.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
          {test.text}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {check && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-800" role="status">
          <p>{storageCheckText(check)}</p>
          {check.missingCount > 0 && <p className="mt-1 text-amber-800">Photos with a missing file need to be taken again by a worker or removed by the webmaster.</p>}
          {check.orphanCount > 0 && (
            <button type="button" className="mt-2 min-h-[44px] rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-800 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-lions-blue" disabled={busy !== null} onClick={() => setDeleteOpen(true)}>
              Delete stray files
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete stray files?"
        description="These files belong to no photo. They are removed from storage for good."
        confirmLabel="Delete them"
        destructive
        onConfirm={() => {
          setDeleteOpen(false);
          void runCheck("delete_orphans");
        }}
      />
    </section>
  );
}
