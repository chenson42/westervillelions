/**
 * Pure, client-safe logic behind the Slice 2 admin controls: the status-button
 * table (mirrors session-status.ts, and a test pins the two together), the copy
 * for each action's result, and which registrant actions apply to which row.
 * No React, no fetch. Types and vocabularies come from admin-contract.ts.
 */

import type {
  CrewCodeResponse,
  RefundResolutionResponse,
  RegistrantDto,
  SessionKind,
  SessionStatus,
  SettableStatus,
  StorageCheckResponse,
  StorageStatus,
  StuffyState,
} from "./admin-contract";
import { STUFFY_STATES } from "./admin-contract";

export interface StatusAction {
  to: SettableStatus;
  label: string;
  /** Primary look for the forward move. */
  primary: boolean;
  confirm: { title: string; body: string; confirmLabel: string; destructive: boolean } | null;
}

const ACTIVATE: StatusAction = { to: "active", label: "Activate", primary: true, confirm: null };
const REOPEN: StatusAction = { to: "active", label: "Reopen", primary: true, confirm: null };
const CLOSE: StatusAction = {
  to: "closed",
  label: "Close session",
  primary: false,
  confirm: {
    title: "Close this session?",
    body: "Worker phones are locked out right away. Admins can still open the crew app, and you can reopen the session later.",
    confirmLabel: "Close session",
    destructive: true,
  },
};
const BACK_TO_DRAFT: StatusAction = {
  to: "draft",
  label: "Back to draft",
  primary: false,
  confirm: {
    title: "Move back to draft?",
    body: "Worker phones are locked out until you activate the session again. This only works while nothing has been tagged or photographed.",
    confirmLabel: "Back to draft",
    destructive: false,
  },
};

/** The buttons for a status. Mirrors the server's table (draft to active or closed, active to closed or draft, closed to active). */
export function statusActionsFor(status: SessionStatus): StatusAction[] {
  switch (status) {
    case "draft":
      return [ACTIVATE, { ...CLOSE, label: "Close without opening", confirm: CLOSE.confirm }];
    case "active":
      return [CLOSE, BACK_TO_DRAFT];
    case "closed":
      return [REOPEN];
    case "purged":
      return [];
    default: {
      const never: never = status;
      return never;
    }
  }
}

export function statusDoneText(to: SettableStatus, noop: boolean): string {
  if (noop) return "It was already that way.";
  switch (to) {
    case "active":
      return "The session is active. Worker phones can sign in with the code.";
    case "closed":
      return "The session is closed. Worker phones are locked out.";
    case "draft":
      return "The session is back to draft.";
    default: {
      const never: never = to;
      return never;
    }
  }
}

export function statusHelp(status: SessionStatus, kind: SessionKind): string {
  switch (status) {
    case "draft":
      return kind === "real"
        ? "Not open to the crew yet. A real session needs a passing photo storage test in the last 10 minutes before it can be activated."
        : "Not open to the crew yet. Activate it to get the worker code.";
    case "active":
      return "Open to the crew. Pause the worker code below for a short stop without closing.";
    case "closed":
      return "Closed. Worker phones are locked out; admins can still open the crew app.";
    case "purged":
      return "This session's data has been removed.";
    default: {
      const never: never = status;
      return never;
    }
  }
}

// ---------------------------------------------------------------------------
// Worker code card
// ---------------------------------------------------------------------------

export function codeCardStatus(access: { issued: boolean; paused: boolean }, status: SessionStatus): { tone: "gray" | "green" | "amber"; text: string } {
  if (!access.issued) return { tone: "gray", text: "No code yet. Activating the session issues one." };
  if (status !== "active") return { tone: "amber", text: "The code is on file but the session is not active, so phones cannot use it." };
  if (access.paused) return { tone: "amber", text: "Paused. Phones are locked out until you resume." };
  return { tone: "green", text: "Live. Phones can sign in with the code." };
}

export function devicesActiveText(count: number): string {
  return `${count} phone${count === 1 ? "" : "s"} used the current code in the last hour. Rotating signs ${count === 1 ? "it" : "them"} out and they need the new code.`;
}

/**
 * B-181: the sentence added to the Close dialog. The count is the same "phones that used
 * the code in the last hour" number the rotate dialog reports (GET crew-code). Null when none.
 */
export function closeWarningText(devices: number): string | null {
  if (!Number.isFinite(devices) || devices < 1) return null;
  return `${devices} phone${devices === 1 ? "" : "s"} used the code in the last hour. Photos still waiting on ${devices === 1 ? "it" : "them"} cannot be sent after closing.`;
}

export function codeShownText(c: CrewCodeResponse): string {
  if (c.unreadable) return "The stored code can no longer be read (the server secret changed). Rotate to issue a new one.";
  if (!c.code) return "No code has been issued yet.";
  return `${c.activeDevicesLastHour} phone${c.activeDevicesLastHour === 1 ? "" : "s"} used it in the last hour.`;
}

/** The text a chair pastes into a message to the crew. */
export function crewInvitation(origin: string, slug: string, formattedCode: string | null): string {
  const link = `${origin}/santas-workshop/crew/${slug}`;
  return formattedCode ? `Santa's Workshop crew: open ${link} and enter the code ${formattedCode}.` : link;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function storageModeText(mode: StorageStatus["mode"]): string {
  switch (mode) {
    case "drive":
      return "the club's photo storage";
    case "local":
      return "this computer's disk (development only)";
    case "memory":
      return "memory (tests only)";
    default: {
      const never: never = mode;
      return never;
    }
  }
}

export function storageCheckText(c: StorageCheckResponse): string {
  const bits: string[] = [];
  bits.push(c.orphanCount === 0 ? "No stray files." : `${c.orphanCount} stray file${c.orphanCount === 1 ? "" : "s"} no photo points to.`);
  bits.push(c.missingCount === 0 ? "No photo is missing its file." : `${c.missingCount} photo${c.missingCount === 1 ? "" : "s"} missing ${c.missingCount === 1 ? "its" : "their"} file.`);
  if (!c.complete) bits.push("The list was cut short. Run the check again after deleting.");
  return bits.join(" ");
}

// ---------------------------------------------------------------------------
// Registrant actions
// ---------------------------------------------------------------------------

export interface RegistrantActionSet {
  withdraw: boolean;
  dismissAttention: boolean;
  refund: boolean;
  revert: boolean;
}

/** Which actions to offer on a row. The server re-checks every one. */
export function registrantActions(r: Pick<RegistrantDto, "state" | "withdrawn" | "needsAttention" | "refund">, sessionKind: SessionKind, sessionStatus: SessionStatus): RegistrantActionSet {
  const live = sessionStatus !== "purged";
  return {
    withdraw: live && !r.withdrawn && (r.state === "registered" || r.state === "tagged"),
    dismissAttention: live && r.needsAttention && !r.withdrawn,
    refund: live && r.refund !== "none",
    // Real sessions too: a wrong scan on the weekend needs a screen to fix it. The server demands a reason either way.
    revert: live && r.state !== "registered",
  };
}

/** Earlier states a stuffy can be put back to. Practice: any earlier state. Real: only the last step. */
export function revertTargets(state: StuffyState, kind: SessionKind = "practice"): StuffyState[] {
  const earlier = STUFFY_STATES.slice(0, STUFFY_STATES.indexOf(state));
  return kind === "real" ? earlier.slice(-1) : earlier;
}

export function revertButtonLabel(kind: SessionKind): string {
  return kind === "real" ? "Revert last step" : "Go back a step (practice)";
}

export const REVERT_HISTORY_NOTE = "The change and your reason are recorded in the history.";

export function refundResolutionText(res: RefundResolutionResponse, resolution: "keep" | "withdraw"): string {
  if (resolution === "keep") return "Kept. The refund flag is cleared for the amount refunded so far.";
  const parts: string[] = [`${res.withdrawn} ${res.withdrawn === 1 ? "stuffy" : "stuffies"} withdrawn.`];
  if (res.stillInCustody > 0) {
    parts.push(`${res.stillInCustody} already in custody ${res.stillInCustody === 1 ? "stays" : "stay"} flagged: they cannot be withdrawn.`);
  }
  return parts.join(" ");
}
