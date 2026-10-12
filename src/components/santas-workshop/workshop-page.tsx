import type { WorkshopFacts } from "@/lib/santas-workshop/facts";
import { focusDay, type WorkshopState } from "@/lib/santas-workshop/state";
import { Art } from "./art";
import { workshopCopy } from "./copy";
import { Hero } from "./hero";
import { SignupSection } from "./signup-section";
import {
  AfterYouRegister,
  CollageLink,
  GoodToKnow,
  PresentedBy,
  Questions,
  Story,
  ThankYou,
  Weekend,
  WhatToBring,
  WhereTheMoneyGoes,
  YourPrivacy,
} from "./sections";
import { TrainMotif } from "./train-motif";

interface WorkshopPageProps {
  state: WorkshopState;
  facts: WorkshopFacts;
  now: Date;
}

/** Sections that depend on the state; the exhaustive switch makes a new state a compile error. */
function stateBody(state: WorkshopState, facts: WorkshopFacts, now: Date): React.ReactNode {
  const c = workshopCopy(facts);
  const focus = focusDay(now, facts);
  switch (state) {
    case "before":
      return (
        <>
          <Story />
          <Weekend c={c} focus={null} />
          <WhatToBring />
          <GoodToKnow c={c} />
        </>
      );
    case "open":
      return (
        <>
          <SignupSection facts={facts} c={c} />
          {facts.zeffyShareUrl !== "" && <AfterYouRegister c={c} />}
          <Story />
          <Weekend c={c} focus={null} />
          <WhatToBring />
          <GoodToKnow c={c} />
        </>
      );
    case "closed":
      return (
        <>
          {facts.collagePath && <CollageLink c={c} collagePath={facts.collagePath} />}
          <AfterYouRegister c={c} />
          <Weekend c={c} focus={focus} />
          <WhatToBring />
          <GoodToKnow c={c} />
        </>
      );
    case "after":
      return <ThankYou c={c} collagePath={facts.collagePath} />;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function WorkshopPage({ state, facts, now }: WorkshopPageProps) {
  const c = workshopCopy(facts);
  const signupAvailable = state === "open" && facts.zeffyShareUrl !== "";
  return (
    <div data-testid="workshop-page" data-state={state} className="min-h-screen">
      <Hero
        state={state}
        c={c}
        signupAvailable={signupAvailable}
        art={<Art id="hero-scene" crop="aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9] rounded-t-2xl" sizes="(min-width: 1024px) 1024px, 100vw" priority />}
      />
      <div className="sw-night pb-0">
        <TrainMotif tone="night" />
      </div>
      {stateBody(state, facts, now)}
      <YourPrivacy c={c} />
      <WhereTheMoneyGoes facts={facts} />
      <Questions />
      <PresentedBy c={c} host={facts.host} />
    </div>
  );
}
