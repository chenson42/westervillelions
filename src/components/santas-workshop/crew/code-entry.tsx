"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnterRequest } from "@/lib/santas-workshop/crew-contract";
import { crewPaths, postJson } from "./crew-api";
import { crewFailureMessage } from "./crew-messages";
import { CREW_BTN, CREW_CARD, CREW_INPUT, CREW_LABEL, CREW_NOTICE_AMBER } from "./crew-styles";

interface Props {
  slug: string;
  /** Why the worker is here again (paused, closed, signed out). Shown only after a valid cookie said so. */
  notice?: string | null;
  /** Called after a good code instead of refreshing the page (used when the app was already open). */
  onEntered?: () => void;
}

/**
 * The only thing a visitor without a worker cookie ever sees on a crew URL. It says
 * nothing about the session (not its name, not whether it exists): a wrong code, a
 * rotated code, a paused or closed session and an unknown address all look alike.
 */
export function CodeEntry({ slug, notice, onEntered }: Props) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const body: EnterRequest = { code };
    const res = await postJson<{ ok: true }>(crewPaths(slug).enter, body);
    setBusy(false);
    if (res.ok) {
      setCode("");
      if (onEntered) onEntered();
      else router.refresh();
      return;
    }
    setError(crewFailureMessage(res.body, "enter"));
  }

  return (
    <main className="fixed inset-0 z-[60] overflow-y-auto bg-lions-blue-dark px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <p className="text-center text-sm uppercase tracking-widest text-lions-gold">Santa&rsquo;s Workshop crew</p>
        <h1 className="mt-2 text-center text-3xl font-bold text-white">Enter the worker code</h1>
        <form onSubmit={submit} className={`${CREW_CARD} mt-6 space-y-4 p-6`}>
          {notice && (
            <p role="status" className={CREW_NOTICE_AMBER}>
              {notice}
            </p>
          )}
          <div>
            <label htmlFor={inputId} className={CREW_LABEL}>
              Worker code
            </label>
            <input
              id={inputId}
              name="code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={40}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={`${CREW_INPUT} text-center text-2xl tracking-widest`}
            />
            <p className="mt-2 text-sm text-gray-600">The event chair texts it to you. Capitals, spaces and dashes don&rsquo;t matter.</p>
          </div>
          {error && (
            <p id={errorId} role="alert" className="rounded-2xl bg-red-50 p-3 text-red-800">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || code.trim().length === 0} className={CREW_BTN}>
            {busy ? "Checking…" : "Start"}
          </button>
        </form>
      </div>
    </main>
  );
}
