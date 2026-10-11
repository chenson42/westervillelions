import { DeliverySwitch } from "@/components/santas-workshop/delivery-switch";
import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { MemoryBook } from "@/components/santas-workshop/memory-book";
import { PhoneFrame } from "@/components/santas-workshop/phone-frame";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";

export default function BookPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="Sunday, on the phone"
        title="The memory book, paperless"
        lead="A swipeable keepsake with a page for every stop. Families can save it as a PDF or share it with faraway grandparents."
      />
      <div className="sw-snow-bg px-4 py-10">
        <div className="mx-auto max-w-5xl space-y-8 md:grid md:grid-cols-[390px_1fr] md:items-start md:gap-10 md:space-y-0">
          <PhoneFrame label="Memory book on a phone" className="md:bg-gray-900">
            <div className="bg-gray-50 p-3">
              <MemoryBook />
            </div>
          </PhoneFrame>
          <div className="space-y-4">
            <DeliverySwitch />
            <p className="rounded-2xl bg-white p-5 text-gray-700 shadow-sm">
              A printed keepsake card is handed over at pickup, so there is something to hold while the book lives on
              the phone.
            </p>
          </div>
        </div>
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/book`} />
    </>
  );
}
