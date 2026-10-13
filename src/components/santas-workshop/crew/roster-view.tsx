"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CrewRosterRow, CrewSearchResponse } from "@/lib/santas-workshop/crew-contract";
import { crewFetch, crewPaths } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { CREW_BTN_SMALL, CREW_CARD, CREW_INPUT, CREW_LABEL } from "./crew-styles";
import {
  CREW_STATE_LABELS,
  ROSTER_FILTERS,
  ROSTER_FILTER_LABELS,
  crewDisplayName,
  filterRoster,
  nextStep,
  tagText,
  windowLabelFor,
  type RosterFilter,
} from "./crew-ui";

interface Props {
  ctx: CrewCtx;
  /** A sticker just scanned that is not on any stuffy: the worker is choosing which stuffy it goes on. */
  pendingTag?: string;
  loadedAt: number | null;
  loadError: string | null;
}

const STATE_TONE: Record<CrewRosterRow["state"], string> = {
  registered: "bg-gray-100 text-gray-700",
  tagged: "bg-lions-blue/10 text-lions-blue",
  checked_in: "bg-lions-gold/25 text-gray-900",
  portrait_taken: "bg-green-100 text-green-800",
  picked_up: "bg-gray-200 text-gray-700",
};

export function RosterView({ ctx, pendingTag, loadedAt, loadError }: Props) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>(pendingTag ? "registered" : "all");
  const [serverMatches, setServerMatches] = useState<CrewRosterRow[]>([]);

  // Family-name search: the server matches the parent's name and returns only stuffies.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setServerMatches([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const res = await crewFetch<CrewSearchResponse>(crewPaths(ctx.slug).search(q));
      if (!live) return;
      if (res.ok) setServerMatches(res.data.stuffies);
      else {
        setServerMatches([]);
        if (res.status === 401) ctx.failureText(res, "search");
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // ctx identity changes every render; only the slug and the typed text drive the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ctx.slug]);

  const visible = useMemo(() => filterRoster(ctx.rows, { query, filter, serverMatches }), [ctx.rows, query, filter, serverMatches]);
  const counts = useMemo(() => {
    const c: Record<RosterFilter, number> = { all: ctx.rows.length, registered: 0, tagged: 0, checked_in: 0, portrait_taken: 0, picked_up: 0 };
    for (const r of ctx.rows) c[r.state] += 1;
    return c;
  }, [ctx.rows]);
  const sendingFor = useMemo(() => new Set(ctx.outboxSnap.items.map((i) => i.stuffyId).filter(Boolean) as string[]), [ctx.outboxSnap.items]);

  return (
    <div className="space-y-4 px-4 py-4">
      {pendingTag && (
        <p role="status" className="rounded-2xl bg-lions-gold/25 p-4 font-semibold text-gray-900">
          That sticker isn&rsquo;t on a stuffy yet. Tap the stuffy it belongs to.
        </p>
      )}
      <div>
        <label htmlFor={searchId} className={CREW_LABEL}>
          Find a stuffy
        </label>
        <input
          id={searchId}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Stuffy name or family name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={CREW_INPUT}
        />
      </div>

      <div role="group" aria-label="Filter by step" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {ROSTER_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 ${
              filter === f ? "bg-lions-blue text-white" : "bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
            }`}
          >
            {ROSTER_FILTER_LABELS[f]} ({counts[f]})
          </button>
        ))}
      </div>

      {loadError && (
        <p role="alert" className="rounded-2xl bg-red-50 p-3 text-red-800">
          {loadError}
        </p>
      )}

      {loadedAt === null && !loadError ? (
        <ul aria-label="Loading the list" className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-20 animate-pulse rounded-2xl bg-gray-200" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl bg-gray-50 p-10 text-center text-gray-500">
          {ctx.rows.length === 0 ? (
            <>
              <p className="font-medium">No stuffies are registered yet.</p>
              <p className="mt-1 text-sm">When families sign up they appear here by themselves.</p>
            </>
          ) : (
            <>
              <p className="font-medium">No stuffy matches that.</p>
              <p className="mt-1 text-sm">Check the spelling, or pick a different step above. Not finding it? Ask the event chair.</p>
              <button type="button" className={`${CREW_BTN_SMALL} mt-3`} onClick={() => { setQuery(""); setFilter("all"); }}>
                Show everyone
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => {
            const step = nextStep(r.state);
            const win = windowLabelFor(ctx.session, r.windowId);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => ctx.navigate({ name: "stuffy", id: r.id, row: r, pendingTag })}
                  className={`${CREW_CARD} flex w-full min-h-[72px] items-center gap-3 p-4 text-left transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-lions-blue`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-lg font-semibold text-gray-900">{crewDisplayName(r.name, r.orderSize)}</span>
                    <span className="mt-0.5 block break-words text-sm text-gray-600">
                      {[win, r.description, r.last4 ? tagText(r.last4) : null].filter(Boolean).join(" · ")}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[r.state]}`}>{CREW_STATE_LABELS[r.state]}</span>
                      {r.refundBadge && <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">Refunded</span>}
                      {r.detailsBeingChecked && <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Details being checked</span>}
                      {sendingFor.has(r.id) && <span className="inline-flex rounded-full bg-lions-gold/25 px-2.5 py-0.5 text-xs font-semibold text-gray-900">Photo sending</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-lions-blue">{pendingTag ? "Choose" : step.label} &rarr;</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
