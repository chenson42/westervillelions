import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { PhoneFrame } from "@/components/santas-workshop/phone-frame";
import { PhotoStation } from "@/components/santas-workshop/photo-station";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";

export default function PhotoStationPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Saturday, at the decorated house"
        title="The photo station"
        lead="Pick the scene, pick the stuffy, take the photo, send it on. About 300 photos in one day, so each one needs to take seconds."
      />
      <div className="sw-snow-bg px-0 py-0 md:px-4 md:py-10">
        <PhoneFrame label="Photo station on a phone">
          <PhotoStation />
        </PhoneFrame>
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/photo-station`} />
    </>
  );
}
