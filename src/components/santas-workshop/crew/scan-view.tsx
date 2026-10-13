"use client";

import { useState } from "react";
import type { ScanRequest, ScanResult } from "@/lib/santas-workshop/crew-contract";
import { crewPaths, postJson } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN, CREW_BTN_OUTLINE, CREW_CARD, CREW_NOTICE_AMBER } from "./crew-styles";
import { describeScan } from "./crew-ui";
import { Scanner } from "./scanner";

type Outcome =
  | { kind: "idle" }
  | { kind: "not_tagged"; code: string; message: string }
  | { kind: "stop"; message: string }
  | { kind: "error"; message: string };

/**
 * The scan screen. A believed sticker is looked up; a tagged stuffy opens on the step
 * it is on. A sticker no stuffy has offers "Tag it now" (choose the stuffy, then bind)
 * or "Find by name". The next scan is allowed at once: nothing here waits on a photo upload.
 */
export function ScanView({ ctx }: { ctx: CrewCtx }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function lookup(code: string) {
    if (busy) return;
    setBusy(true);
    setOutcome({ kind: "idle" });
    const body: ScanRequest = { code };
    const res = await postJson<ScanResult>(crewPaths(ctx.slug).scan, body);
    setBusy(false);
    if (!res.ok) {
      setOutcome({ kind: "error", message: ctx.failureText(res, "scan") });
      return;
    }
    const directive = describeScan(res.data);
    switch (directive.kind) {
      case "open":
        ctx.navigate({ name: "stuffy", id: directive.row.id, row: directive.row });
        return;
      case "not_tagged":
        setOutcome({ kind: "not_tagged", code, message: directive.message });
        return;
      case "retired":
      case "withdrawn":
        setOutcome({ kind: "stop", message: directive.message });
        return;
      default: {
        const never: never = directive;
        setOutcome({ kind: "error", message: String(never) });
      }
    }
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <h2 className="text-2xl font-bold text-gray-900">Scan a sticker</h2>
      {outcome.kind === "not_tagged" && (
        <div role="alert" className={`${CREW_CARD} space-y-3 p-4`}>
          <p className="text-lg font-semibold text-gray-900">{outcome.message}</p>
          <button type="button" className={CREW_BTN} onClick={() => ctx.navigate({ name: "list", pendingTag: outcome.code })}>
            Tag it now
          </button>
          <button type="button" className={CREW_BTN_OUTLINE} onClick={() => ctx.navigate({ name: "list" })}>
            Find by name
          </button>
        </div>
      )}
      {outcome.kind === "stop" && (
        <div role="alert" className={`${CREW_NOTICE_AMBER} space-y-3`}>
          <p className="font-semibold">{outcome.message}</p>
          <button type="button" className={CREW_BTN_OUTLINE} onClick={() => ctx.navigate({ name: "list" })}>
            Find by name
          </button>
        </div>
      )}
      {outcome.kind === "error" && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {outcome.message}
        </p>
      )}
      <Scanner busy={busy} hint="Point the camera at the sticker on the stuffy." onCode={(c) => void lookup(c)} />
    </div>
  );
}
