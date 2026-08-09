"use client";

import { useEffect, useState } from "react";
import { MinutesForm, type EventOption, type MemberOption, type InitialMinutesData } from "./minutes-form";
import { MinutesStatusActions } from "./minutes-status-actions";
import { MinutesEmailPrompt } from "./minutes-email-prompt";
import { MinutesDetail, type MinutesDetailData } from "@/components/minutes/minutes-detail";

interface MinutesEditorShellProps {
  minutesId: string;
  kind: string;
  status: string;
  pendingDeleteAt: string | null;
  approvedAt: string | null;
  canDelete: boolean;
  eventOptions: EventOption[];
  memberOptions: MemberOption[];
  currentMemberId: string | null;
  initial: InitialMinutesData;
  detailData: MinutesDetailData;
  /** True on first load right after POST /api/admin/minutes redirected here
   *  (?justSaved=1) — auto-opens the post-save email prompt, per Phase 3
   *  "appears after every successful save (create or update)". */
  justSaved: boolean;
}

/**
 * Client shell tying together the admin minutes detail page's moving parts:
 * the draft edit form OR the approved read-only view, the status action bar
 * (Approve / Reopen / Delete / Restore), and the post-save email prompt.
 * Kept as one component (rather than page-level prop drilling) so the
 * "just saved → open the email prompt" and "status action → refresh →
 * re-render the right branch" flows share one piece of state.
 */
export function MinutesEditorShell({
  minutesId,
  kind,
  status,
  pendingDeleteAt,
  approvedAt,
  canDelete,
  eventOptions,
  memberOptions,
  currentMemberId,
  initial,
  detailData,
  justSaved,
}: MinutesEditorShellProps) {
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);

  useEffect(() => {
    if (justSaved) setEmailPromptOpen(true);
    // Only ever fires once, on the redirect from a fresh create — status
    // changes (approve/reopen) refresh server data but don't remount this
    // component with a new justSaved value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDeleted = !!pendingDeleteAt;
  const isDraft = status === "draft" && !isDeleted;
  const isApproved = status === "approved" && !isDeleted;

  return (
    <div className="space-y-6">
      {isDraft && approvedAt && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          Previously approved {new Date(approvedAt).toLocaleDateString()}, reopened for correction.
          Re-approving will replace the approval date.
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
        <MinutesStatusActions
          minutesId={minutesId}
          status={status}
          pendingDeleteAt={pendingDeleteAt}
          canDelete={canDelete}
          onRequestEmail={() => setEmailPromptOpen(true)}
        />
      </div>

      {isDraft && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
          <MinutesForm
            mode="edit"
            minutesId={minutesId}
            eventOptions={eventOptions}
            memberOptions={memberOptions}
            currentMemberId={currentMemberId}
            initial={initial}
            onSaved={() => setEmailPromptOpen(true)}
          />
        </div>
      )}

      {(isApproved || isDeleted) && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
          <MinutesDetail minutes={detailData} />
        </div>
      )}

      <MinutesEmailPrompt
        open={emailPromptOpen}
        onOpenChange={setEmailPromptOpen}
        minutesId={minutesId}
        kind={kind}
        status={status}
      />
    </div>
  );
}
