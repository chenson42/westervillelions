import { AfterStrip, HowItWorks, PresentedBy, PrivacyLine, Scenes, Story, WhatToBring } from "@/components/santas-workshop/landing-sections";
import { ArtSlot } from "@/components/santas-workshop/art-slot";
import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { LandingHero } from "@/components/santas-workshop/landing-hero";
import { PinnedReserve } from "@/components/santas-workshop/pinned-reserve";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { TrainMotif } from "@/components/santas-workshop/train-motif";
import { ZeffyFormCard } from "@/components/santas-workshop/zeffy-form-card";

export default function PreviewLandingPage() {
  return (
    <>
      <LandingHero
        art={
          <ArtSlot
            id="hero-scene"
            tone="night"
            crop="aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9] rounded-t-2xl"
            sizes="(min-width: 1024px) 1024px, 100vw"
            priority
          />
        }
      />
      <div className="sw-night pb-0">
        <TrainMotif tone="night" />
      </div>
      <Story />
      <HowItWorks />
      <Scenes />
      <WhatToBring />
      <ZeffyFormCard afterStrip={<AfterStrip />} />
      <PrivacyLine />
      <PresentedBy />
      <div className="pb-20 md:pb-0">
        <FlowFooter current={PREVIEW_BASE} />
      </div>
      <PinnedReserve />
    </>
  );
}
