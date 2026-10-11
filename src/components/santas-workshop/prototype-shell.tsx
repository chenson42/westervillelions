"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PreviewStateProvider, usePreviewState } from "./preview-state";
import { LANDING_STATES, LANDING_STATE_COPY, type LandingState } from "./landing-state";
import { PREVIEW_BASE, SCREENS } from "./screens";

function Banner() {
  return (
    <div className="bg-[#0b1b33] text-white" role="note">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
        <span className="shrink-0 rounded-full bg-lions-gold px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest text-gray-900">
          Prototype
        </span>
        <p className="text-white/90">Sample content, nothing here is real or saved.</p>
      </div>
    </div>
  );
}

function ScreenSwitcher({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Prototype screens" className="bg-white border-b border-gray-200">
      <ul className="sw-scroller max-w-6xl mx-auto flex gap-2 overflow-x-auto px-4 py-2">
        {SCREENS.map((s) => {
          const current = s.href === pathname;
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                title={s.who}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 ${
                  current
                    ? "bg-lions-blue text-white"
                    : "bg-gray-100 text-gray-800 hover:bg-lions-blue/10"
                }`}
              >
                {s.shortLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function StateToggle() {
  const { landingState, setLandingState } = usePreviewState();
  return (
    <fieldset className="bg-lions-blue/5 border-b border-lions-blue/10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <legend className="float-left text-sm font-semibold text-lions-blue-dark sm:float-none">
          Preview the page as
        </legend>
        <div className="flex flex-wrap gap-2 clear-both sm:clear-none">
          {LANDING_STATES.map((s: LandingState) => (
            <label key={s} className="relative">
              <input
                type="radio"
                name="sw-landing-state"
                value={s}
                checked={landingState === s}
                onChange={() => setLandingState(s)}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border-2 border-lions-blue/30 bg-white px-4 text-sm font-semibold text-lions-blue-dark transition hover:bg-lions-blue/5 peer-checked:border-lions-blue peer-checked:bg-lions-blue peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-lions-blue peer-focus-visible:ring-offset-2">
                {landingState === s && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                    <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
                  </svg>
                )}
                {LANDING_STATE_COPY[s].label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const onLanding = pathname === PREVIEW_BASE;
  return (
    <>
      <Banner />
      <ScreenSwitcher pathname={pathname} />
      {onLanding && <StateToggle />}
      {children}
    </>
  );
}

export function PrototypeShell({ children }: { children: React.ReactNode }) {
  return (
    <PreviewStateProvider>
      <ShellInner>{children}</ShellInner>
    </PreviewStateProvider>
  );
}
