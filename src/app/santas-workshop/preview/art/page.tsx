import { ART_SLOTS, aspectCss } from "@/components/santas-workshop/art-slots";
import { FlowFooter } from "@/components/santas-workshop/flow-footer";
import { PREVIEW_BASE, SCREENS } from "@/components/santas-workshop/screens";
import { ScreenHeader } from "@/components/santas-workshop/screen-header";

const labelFor = (href: string) => SCREENS.find((s) => s.href === href)?.shortLabel ?? href;

export default function ArtBriefPage() {
  const needed = ART_SLOTS.filter((s) => s.src === null).length;
  return (
    <>
      <ScreenHeader
        eyebrow="For the artist"
        title="Art brief"
        lead="Every dashed box in the prototype is one of these. Put the file at the path shown, then add the slot id to the SUPPLIED list at the top of art-slots.ts, and the box becomes your image."
      />
      <div className="sw-snow-bg px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <p className="rounded-2xl bg-white p-5 text-gray-800 shadow-sm">
            <span className="font-semibold">{needed} of {ART_SLOTS.length} slots needed.</span> Files go in{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">public/images/santas-workshop/</code>. Use SVG
            for vector art, WebP or high-quality JPEG at 2x for pictures, and give every non-decorative image a short
            description.
          </p>
          <p className="mt-3 rounded-2xl border-2 border-lions-blue/20 bg-white p-5 text-gray-800">
            <span className="font-semibold">Please do not supply</span> IHOP&rsquo;s logo or branding, or any
            preschool&rsquo;s logo, until they agree. The name in text is enough for now.
          </p>
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {ART_SLOTS.map((s) => (
              <li key={s.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex w-24 shrink-0 items-center justify-center">
                    <div
                      aria-hidden="true"
                      className="sw-hatch w-full border-2 border-dashed border-lions-blue/50"
                      style={{ aspectRatio: aspectCss(s.aspect), maxHeight: "7rem" }}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="sw-display text-lg font-semibold text-lions-blue-dark">{s.label}</h2>
                    <p className="text-sm font-semibold text-gray-900">
                      {s.aspect} · {s.pixels}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                        s.src ? "bg-[#1f5c4a] text-white" : "bg-lions-gold text-gray-900"
                      }`}
                    >
                      {s.src ? "Supplied" : "Needed"}
                    </span>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-sm text-gray-700">
                  <div>
                    <dt className="font-semibold text-gray-900">Used on</dt>
                    <dd>{s.usedOn.map(labelFor).join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-900">Notes</dt>
                    <dd>{s.notes}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-900">File</dt>
                    <dd className="break-all">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5">{s.path}</code>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-900">Description</dt>
                    <dd>{s.decorative ? "Decorative (no description needed)" : s.alt}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <FlowFooter current={`${PREVIEW_BASE}/art`} />
    </>
  );
}
