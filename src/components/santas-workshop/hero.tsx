import type { WorkshopState } from "@/lib/santas-workshop/state";
import type { WorkshopCopy } from "./copy";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-2xl bg-white/10 px-5 py-3 ring-1 ring-white/25 backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-lions-gold">{label}</p>
      <p className="sw-display text-xl font-semibold text-white">{value}</p>
    </li>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="mx-auto mt-8 inline-flex min-h-12 items-center gap-2 rounded-lg border-2 border-white/40 bg-white/10 px-6 py-3 text-lg font-semibold text-white"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {children}
    </p>
  );
}

interface HeroProps {
  state: WorkshopState;
  c: WorkshopCopy;
  signupAvailable: boolean;
  /** Optional hero artwork (renders nothing when the slot is not supplied). */
  art?: React.ReactNode;
}

function lead(state: WorkshopState, c: WorkshopCopy): string {
  switch (state) {
    case "before":
    case "open":
      return c.hero.leadOpen;
    case "closed":
      return c.hero.leadClosed;
    case "after":
      return c.hero.leadAfter;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function cta(state: WorkshopState, c: WorkshopCopy, signupAvailable: boolean): React.ReactNode {
  switch (state) {
    case "before":
      return <StatusPill>{c.hero.statusBefore}</StatusPill>;
    case "open":
      return signupAvailable ? (
        <div className="mt-8">
          <a
            href="#signup"
            className="inline-flex min-h-12 transform items-center justify-center rounded-lg bg-lions-gold px-8 py-4 text-lg font-semibold text-gray-900 transition hover:scale-105 hover:bg-lions-gold-dark focus:outline-none focus:ring-2 focus:ring-lions-gold focus:ring-offset-2 focus:ring-offset-lions-blue-dark"
          >
            {c.hero.ctaOpen}
          </a>
        </div>
      ) : (
        <StatusPill>{c.hero.statusNotReady}</StatusPill>
      );
    case "closed":
      return <StatusPill>{c.hero.statusClosed}</StatusPill>;
    case "after":
      return null;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function Hero({ state, c, signupAvailable, art }: HeroProps) {
  const after = state === "after";
  return (
    <section aria-labelledby="sw-title" className="sw-night relative overflow-hidden text-white">
      <div className="sw-snowfall" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl px-4 pt-12 pb-10 text-center md:pt-20">
        <p className="mb-3 text-sm uppercase tracking-widest text-lions-gold">{c.hero.eyebrow}</p>
        <h1
          id="sw-title"
          className="sw-display mx-auto max-w-3xl font-semibold leading-tight text-balance"
          style={{ fontSize: "clamp(2.25rem, 9vw, 4rem)" }}
        >
          {after ? c.hero.titleAfter : c.title}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-white/90 md:text-xl">{lead(state, c)}</p>

        {!after && (
          <ul className="mt-8 flex flex-wrap items-stretch justify-center gap-3">
            <Fact label="When" value={c.dateRange} />
            <Fact label="Cost" value={c.pricePerStuffy} />
            <Fact label="Where" value={c.place} />
          </ul>
        )}

        {cta(state, c, signupAvailable)}
      </div>
      {art ? <div className="relative mx-auto max-w-5xl px-4 pb-0">{art}</div> : null}
    </section>
  );
}
