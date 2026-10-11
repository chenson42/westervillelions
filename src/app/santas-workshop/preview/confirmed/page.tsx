import Link from "next/link";
import { ArtSlot } from "@/components/santas-workshop/art-slot";
import {
  DROPOFF_PLACE,
  DROPOFF_WINDOWS,
  EVENT_DATES,
  PICKUP_WINDOW,
  PRICE_DOLLARS,
  formatLongDate,
} from "@/components/santas-workshop/event-facts";
import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { SAMPLE_JOURNEY_STUFFY } from "@/components/santas-workshop/sample-data";
import { PREVIEW_BASE } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";
import { TrainMotif } from "@/components/santas-workshop/train-motif";

const stuffy = SAMPLE_JOURNEY_STUFFY;
const win = DROPOFF_WINDOWS.find((w) => w.id === stuffy.windowId)!;

export default function ConfirmedPage() {
  return (
    <>
      <ScreenHeader
        eyebrow="You're booked"
        title={`${stuffy.name} has a seat on the train`}
        lead="This is a mock of what a family sees after paying: Zeffy's own receipt, plus the club's next steps."
      />
      <div className="sw-snow-bg px-4 py-12">
        <div className="sw-ticket-wrap mx-auto max-w-xl">
          <div className="sw-ticket-top sw-paper-bg rounded-t-2xl p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#9b1c2e]">Boarding pass</p>
                <h2 className="sw-display mt-1 text-3xl font-semibold text-lions-blue-dark">{stuffy.name}</h2>
                <p className="text-gray-700">
                  {stuffy.kind}, {stuffy.color}
                </p>
              </div>
              <div className="w-20 shrink-0">
                <ArtSlot id="conductor-stamp" compact sizes="80px" />
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="font-semibold uppercase tracking-widest text-gray-700">Family</dt>
                <dd className="text-lg font-semibold text-gray-900">{stuffy.familyLabel}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-widest text-gray-700">Paid</dt>
                <dd className="text-lg font-semibold text-gray-900">${PRICE_DOLLARS} (1 stuffy)</dd>
              </div>
            </dl>
          </div>
          <div className="sw-ticket-bottom sw-paper-bg rounded-b-2xl">
            <div className="sw-perforation mx-6" aria-hidden="true" />
            <ol className="space-y-5 p-6 sm:p-8">
              <li>
                <p className="text-xs font-bold uppercase tracking-widest text-lions-blue">
                  {formatLongDate(EVENT_DATES.dropoff)} · {win.label}
                </p>
                <p className="font-semibold text-gray-900">Bring {stuffy.name} to {DROPOFF_PLACE}</p>
                <p className="text-gray-700">The conductor will check your stuffy in.</p>
              </li>
              <li>
                <p className="text-xs font-bold uppercase tracking-widest text-lions-blue">
                  {formatLongDate(EVENT_DATES.photos)}
                </p>
                <p className="font-semibold text-gray-900">The journey</p>
                <p className="text-gray-700">Your stuffy visits Santa&rsquo;s workshop. Nothing to do on your end.</p>
              </li>
              <li>
                <p className="text-xs font-bold uppercase tracking-widest text-lions-blue">
                  {formatLongDate(EVENT_DATES.pickup)} · {PICKUP_WINDOW.label}
                </p>
                <p className="font-semibold text-gray-900">Pickup at {DROPOFF_PLACE}</p>
                <p className="text-gray-700">Collect your stuffy. Its memory book is ready to open on your phone.</p>
              </li>
            </ol>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-xl rounded-2xl border-2 border-dashed border-lions-blue/40 bg-white p-5">
          <span className="rounded-full bg-lions-blue px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Phase 2 idea
          </span>
          <h2 className="sw-display mt-3 text-xl font-semibold text-lions-blue-dark">Your tracking card</h2>
          <p className="mt-1 text-gray-700">
            At check-in you would be handed a card with a QR code. Scan it any time to see where {stuffy.name} is.
          </p>
          <Link
            href={`${PREVIEW_BASE}/follow`}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
          >
            Follow {stuffy.name}&rsquo;s journey
          </Link>
        </div>
      </div>
      <div className="sw-snow-bg">
        <TrainMotif />
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/confirmed`} />
    </>
  );
}
