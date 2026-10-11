import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { FollowDemo } from "@/components/santas-workshop/follow-demo";
import { SAMPLE_JOURNEY } from "@/components/santas-workshop/journey";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";

export default function FollowPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Follow your stuffy"
        title="Where is my stuffy right now?"
        lead="Parents scan the card they were handed at check-in and watch the journey, stop by stop. Only the stuffy's name is ever shown, never the child's."
      />
      <div className="sw-snow-bg px-4 py-10">
        <div className="mx-auto max-w-xl">
          <FollowDemo journey={SAMPLE_JOURNEY} />
          <p className="mt-8 rounded-2xl bg-white p-4 text-sm text-gray-700 shadow-sm">
            The link on the card would look like a long random string, not a name or a number, so no one can guess
            another family&rsquo;s page.
          </p>
        </div>
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/follow`} />
    </>
  );
}
