"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CrewRosterResponse, CrewRosterRow, CrewSessionSummary } from "@/lib/santas-workshop/crew-contract";
import { crewFetch, crewPaths, type CrewCall } from "./crew-api";
import type { CrewCtx, CrewView } from "./crew-context";
import { CodeEntry } from "./code-entry";
import { AUTH_REASON_MESSAGES, crewFailureMessage, type CrewAction } from "./crew-messages";
import { updatedAgoText } from "./crew-ui";
import { GroupPanel } from "./group-panel";
import { OutboxBar } from "./outbox-bar";
import { RosterView } from "./roster-view";
import { ScanView } from "./scan-view";
import { StuffyScreen } from "./stuffy-screen";
import { useOutbox } from "./use-outbox";

const POLL_MS = 20_000;

interface Props {
  slug: string;
  adminBypass: boolean;
}

const PLACEHOLDER_SESSION: CrewSessionSummary = { name: "Santa’s Workshop", kind: "real", status: "active", windows: [], admin: false };

/**
 * The worker app: one client component with an internal view (list, scan, a stuffy,
 * group photo) mirrored to history.pushState, so the phone's back button works and the
 * app is never torn down by a route change. Photos go through the outbox: the worker can
 * scan the next sticker while an upload is still running.
 */
export function CrewApp({ slug, adminBypass }: Props) {
  const [roster, setRoster] = useState<CrewRosterResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authLost, setAuthLost] = useState<string | null>(null);
  const [view, setView] = useState<CrewView>({ name: "list" });
  const [now, setNow] = useState(() => Date.now());
  const stack = useRef<CrewView[]>([{ name: "list" }]);

  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const { outbox, snapshot, durable, ready } = useOutbox(slug, () => void refreshRef.current());

  const refresh = useCallback(async () => {
    const res = await crewFetch<CrewRosterResponse>(crewPaths(slug).roster);
    if (res.ok) {
      setRoster(res.data);
      setLoadedAt(Date.now());
      setLoadError(null);
      return;
    }
    if (res.body?.code === "crew_auth_required") {
      setAuthLost(crewFailureMessage(res.body, "roster"));
      return;
    }
    setLoadError(crewFailureMessage(res.body, "roster"));
  }, [slug]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // First load, then a gentle poll while the page is visible, and a refresh when it comes back.
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Phone back button: walk the view stack.
  useEffect(() => {
    window.history.replaceState({ swIdx: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const idx = typeof e.state?.swIdx === "number" ? (e.state.swIdx as number) : 0;
      const next = stack.current[idx] ?? { name: "list" as const };
      stack.current = stack.current.slice(0, idx + 1);
      if (stack.current.length === 0) stack.current = [next];
      setView(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: CrewView) => {
    if (next.name === "stuffy") {
      stack.current = [...stack.current, next];
      window.history.pushState({ swIdx: stack.current.length - 1 }, "");
    } else {
      stack.current = [next];
      window.history.replaceState({ swIdx: 0 }, "");
    }
    setView(next);
    window.scrollTo?.(0, 0);
  }, []);

  const back = useCallback(() => {
    if (stack.current.length > 1) window.history.back();
    else navigate({ name: "list" });
  }, [navigate]);

  const applyRow = useCallback((row: CrewRosterRow) => {
    setRoster((r) => (r ? { ...r, stuffies: r.stuffies.map((s) => (s.id === row.id ? row : s)) } : r));
  }, []);

  const failureText = useCallback((call: Extract<CrewCall<unknown>, { ok: false }>, action: CrewAction) => {
    if (call.body?.code === "crew_auth_required") setAuthLost(crewFailureMessage(call.body, action));
    return crewFailureMessage(call.body, action);
  }, []);

  // A 401 on an upload holds the outbox; bring the worker to the code screen.
  const heldNotice = snapshot.heldForSignIn ? (snapshot.items.find((i) => i.message)?.message ?? AUTH_REASON_MESSAGES.signed_out) : null;
  const showCodeScreen = authLost ?? heldNotice;

  const session = roster?.session ?? PLACEHOLDER_SESSION;
  const ctx: CrewCtx = useMemo(
    () => ({
      slug,
      session,
      adminBypass,
      rows: roster?.stuffies ?? [],
      outbox,
      outboxSnap: snapshot,
      durable,
      navigate,
      back,
      applyRow,
      refresh,
      failureText,
    }),
    [slug, session, adminBypass, roster, outbox, snapshot, durable, navigate, back, applyRow, refresh, failureText],
  );

  if (showCodeScreen) {
    return (
      <CodeEntry
        slug={slug}
        notice={showCodeScreen}
        onEntered={() => {
          setAuthLost(null);
          outbox.resume();
          void refresh();
        }}
      />
    );
  }

  const tab = view.name === "scan" ? "scan" : view.name === "group" ? "group" : "list";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-50">
      <header className="shrink-0 bg-gradient-to-br from-lions-blue to-lions-blue-dark px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-lions-gold">Crew</p>
            <h1 className="truncate text-lg font-bold">{session.name}</h1>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-white/80" aria-live="polite">
              {updatedAgoText(loadedAt, now)}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="min-h-[44px] rounded px-3 text-sm font-semibold text-lions-gold hover:text-white focus:outline-none focus:ring-2 focus:ring-lions-gold"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>
      {session.kind === "practice" && (
        <p className="shrink-0 bg-lions-gold px-4 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-gray-900">Practice run: nothing here is real</p>
      )}
      {adminBypass && session.status !== "active" && (
        <p className="shrink-0 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          This session is {session.status}. Worker phones are locked out; you are in as a club admin.
        </p>
      )}
      <OutboxBar outbox={outbox} snapshot={snapshot} durable={durable} />

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!ready ? (
          <p className="p-6 text-center text-gray-500">Getting ready&hellip;</p>
        ) : view.name === "list" ? (
          <RosterView ctx={ctx} pendingTag={view.pendingTag} loadedAt={loadedAt} loadError={loadError} />
        ) : view.name === "scan" ? (
          <ScanView ctx={ctx} />
        ) : view.name === "group" ? (
          <GroupPanel ctx={ctx} />
        ) : (
          <StuffyScreen key={view.id} ctx={ctx} initial={view.row} pendingTag={view.pendingTag} />
        )}
      </main>

      <nav aria-label="Crew sections" className="grid shrink-0 grid-cols-3 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {(
          [
            ["list", "Stuffies", { name: "list" } as CrewView],
            ["scan", "Scan", { name: "scan" } as CrewView],
            ["group", "Group photo", { name: "group" } as CrewView],
          ] as const
        ).map(([key, label, target]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => navigate(target)}
            className={`min-h-[60px] text-base font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lions-blue ${
              tab === key ? "bg-lions-blue/10 text-lions-blue" : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
