"use client";

import { useCallback, useEffect, useState } from "react";
import type { CrewCheckInCard, CrewPickupCard, CrewPortraitCard, CrewTagCard, CrewView } from "@/lib/santas-workshop/crew-contract";
import { crewFetch, crewPaths } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { crewFailureMessage } from "./crew-messages";

type CardFor = {
  tag: CrewTagCard;
  checkin: CrewCheckInCard;
  portrait: CrewPortraitCard;
  pickup: CrewPickupCard;
};

export type CardState<V extends CrewView> = { status: "loading" } | { status: "ready"; card: CardFor[V] } | { status: "error"; message: string };

/** Loads one least-data view card for a stuffy; `reload` re-reads it (after a stale-state refusal). */
export function useCard<V extends CrewView>(ctx: CrewCtx, id: string, view: V): { state: CardState<V>; reload: () => void } {
  const [state, setState] = useState<CardState<V>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const slug = ctx.slug;
  const failureText = ctx.failureText;

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await crewFetch<CardFor[V]>(crewPaths(slug).card(id, view));
      if (!live) return;
      if (res.ok) setState({ status: "ready", card: res.data });
      else setState({ status: "error", message: res.status === 401 ? failureText(res, "view") : crewFailureMessage(res.body, "view") });
    })();
    return () => {
      live = false;
    };
    // failureText is re-created each render; the card depends on what it shows, not on that function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, id, view, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { state, reload };
}
