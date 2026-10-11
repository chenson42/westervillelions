import Link from "next/link";
import { neighbours } from "./screens";

export function FlowFooter({ current }: { current: string }) {
  const { prev, next } = neighbours(current);
  return (
    <nav
      id="sw-end"
      aria-label="Previous and next prototype screen"
      className="border-t border-gray-200 bg-white"
    >
      <div className="max-w-6xl mx-auto grid grid-cols-2 gap-3 px-4 py-6">
        <div>
          {prev && (
            <Link
              href={prev.href}
              className="flex min-h-11 flex-col rounded-lg border-2 border-lions-blue/30 px-4 py-2 text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <span className="text-xs uppercase tracking-widest text-gray-600">&larr; Previous</span>
              <span className="font-semibold">{prev.label}</span>
            </Link>
          )}
        </div>
        <div>
          {next && (
            <Link
              href={next.href}
              className="flex min-h-11 flex-col items-end rounded-lg bg-lions-blue px-4 py-2 text-right text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
            >
              <span className="text-xs uppercase tracking-widest text-white/80">Next &rarr;</span>
              <span className="font-semibold">{next.label}</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
