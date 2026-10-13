"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CrewActionResponse, CrewRosterRow, TagRequest } from "@/lib/santas-workshop/crew-contract";
import { crewPaths, newKey, postJson } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN, CREW_BTN_OUTLINE, CREW_CARD, CREW_NOTICE_AMBER } from "./crew-styles";
import { crewDisplayName } from "./crew-ui";
import { Scanner } from "./scanner";
import { useCard } from "./use-card";

interface Props {
  ctx: CrewCtx;
  row: CrewRosterRow;
  /** A scanned sticker that no stuffy has: bind it to this one when the worker confirms. */
  pendingTag?: string;
  /** Called when the worker is done re-tagging an already tagged stuffy. */
  onDone?: () => void;
}

type Confirm = { kind: "move"; otherStuffyName: string } | { kind: "replace"; oldLast4: string } | null;

export function TagPanel({ ctx, row, pendingTag, onDone }: Props) {
  const { state: cardState, reload } = useCard(ctx, row.id, "tag");
  const [code, setCode] = useState<string | null>(pendingTag ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // One idempotency key per intent: a double tap on "Tag it" replays instead of binding twice.
  const keyRef = useRef(newKey());
  const name = crewDisplayName(row.name, row.orderSize);

  function choose(text: string) {
    setCode(text);
    setMessage(null);
    keyRef.current = newKey();
  }

  async function bind(confirmWith?: "move" | "replace") {
    if (!code || busy) return;
    setBusy(true);
    setMessage(null);
    const body: TagRequest = {
      tagCode: code,
      expectedState: row.state,
      // The phone only knows the last four of a sticker already on this stuffy; the server compares those under its lock.
      expectedTagCode: null,
      ...(row.last4 ? { expectedLast4: row.last4 } : {}),
      idempotencyKey: confirmWith ? newKey() : keyRef.current,
      clientTakenAt: new Date().toISOString(),
      ...(confirmWith ? { confirm: confirmWith } : {}),
    };
    const res = await postJson<CrewActionResponse>(crewPaths(ctx.slug).tag(row.id), body);
    setBusy(false);
    if (res.ok) {
      ctx.applyRow(res.data.stuffy);
      toast.success(row.last4 ? `Sticker changed on ${name}` : `Sticker put on ${name}`);
      setCode(null);
      onDone?.();
      return;
    }
    const b = res.body;
    if (b?.code === "confirm_move") {
      setConfirm({ kind: "move", otherStuffyName: b.otherStuffyName });
      return;
    }
    if (b?.code === "confirm_replace") {
      setConfirm({ kind: "replace", oldLast4: b.oldLast4 });
      return;
    }
    setMessage(ctx.failureText(res, "tag"));
    if (b?.code === "stale_state" || b?.code === "tag_already_bound") {
      void ctx.refresh();
      reload();
    }
  }

  return (
    <div className="space-y-4">
      <div className={`${CREW_CARD} p-4`}>
        {cardState.status === "loading" && <p className="text-gray-500">Loading the family&hellip;</p>}
        {cardState.status === "error" && <p className="text-red-800">{cardState.message}</p>}
        {cardState.status === "ready" && (
          <dl className="space-y-1">
            <div>
              <dt className="text-sm text-gray-500">Family</dt>
              <dd className="text-xl font-bold text-gray-900 break-words">{cardState.card.parentName ?? "Name not on file"}</dd>
            </div>
            {cardState.card.orderSize > 1 && (
              <div>
                <dt className="sr-only">Order size</dt>
                <dd className="text-sm text-gray-600">{cardState.card.orderSize} stuffies in this order</dd>
              </div>
            )}
            {cardState.card.last4 && (
              <div>
                <dt className="sr-only">Current sticker</dt>
                <dd className="text-sm text-gray-600">Has a sticker ending {cardState.card.last4}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {code ? (
        <div className="space-y-3">
          <p className="rounded-2xl bg-lions-blue/10 p-4 font-semibold text-lions-blue-dark">
            Sticker ready, ending {code.slice(-4)}.
          </p>
          <button type="button" className={CREW_BTN} disabled={busy} onClick={() => void bind()}>
            {busy ? "Saving…" : `Put this sticker on ${name}`}
          </button>
          <button type="button" className={CREW_BTN_OUTLINE} disabled={busy} onClick={() => setCode(null)}>
            Use a different sticker
          </button>
        </div>
      ) : (
        <div className={`${CREW_CARD} p-4`}>
          <Scanner hint={`Scan the sticker you are putting on ${name}.`} autoStart={false} onCode={choose} />
        </div>
      )}

      {message && (
        <p role="alert" className={CREW_NOTICE_AMBER}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirm?.kind === "move"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Move this sticker?"
        description={
          confirm?.kind === "move"
            ? `That sticker is on “${confirm.otherStuffyName}”. Moving it takes it off that stuffy and puts it on ${name}.`
            : ""
        }
        confirmLabel="Move it"
        destructive
        onConfirm={() => {
          setConfirm(null);
          void bind("move");
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "replace"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Replace the sticker?"
        description={
          confirm?.kind === "replace"
            ? `${name} already has a sticker ending ${confirm.oldLast4}. Replacing it makes the old sticker stop working for this stuffy.`
            : ""
        }
        confirmLabel="Replace it"
        destructive
        onConfirm={() => {
          setConfirm(null);
          void bind("replace");
        }}
      />
    </div>
  );
}
