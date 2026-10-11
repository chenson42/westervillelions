/** Compact night-sky header used by every screen after the landing page. */
export function ScreenHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <header className="sw-night relative overflow-hidden px-4 py-12 text-center text-white">
      <div className="sw-snowfall" aria-hidden="true" />
      <div className="relative mx-auto max-w-3xl">
        <p className="mb-2 text-sm uppercase tracking-widest text-lions-gold">{eyebrow}</p>
        <h1
          className="sw-display font-semibold leading-tight text-balance"
          style={{ fontSize: "clamp(2rem, 7vw, 3rem)" }}
        >
          {title}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">{lead}</p>
      </div>
    </header>
  );
}
