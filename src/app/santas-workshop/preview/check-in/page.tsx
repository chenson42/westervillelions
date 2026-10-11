import { ConductorList } from "@/components/santas-workshop/conductor-list";
import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { PhoneFrame } from "@/components/santas-workshop/phone-frame";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";

export default function CheckInPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Friday evening, at the station"
        title="The conductor's check-in"
        lead="What a volunteer sees on a phone in the restaurant lobby. Try searching, then tap Check in. Nothing is saved; reload to start over."
      />
      <div className="sw-snow-bg px-0 py-0 md:px-4 md:py-10">
        <PhoneFrame label="Conductor check-in on a phone">
          <ConductorList />
        </PhoneFrame>
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/check-in`} />
    </>
  );
}
