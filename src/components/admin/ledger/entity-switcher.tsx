"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { LedgerEntity } from "@/lib/db/schema";

interface EntitySwitcherProps {
  entities: LedgerEntity[];
  activeSlug: string;
  /** Destination path for the switcher. Defaults to /admin/ledger. */
  basePath?: string;
}

/**
 * Tab-style switcher for the Club / Foundation entity context.
 * Updates the ?entity= URL param; preserves ?fy= if present.
 * Uses rounded-lg (not rounded-full) per brand invariant.
 */
export default function EntitySwitcher({ entities, activeSlug, basePath = "/admin/ledger" }: EntitySwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSelect(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("entity", slug);
    router.push(`${basePath}?${params}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 w-fit">
      {entities.map((entity) => {
        const isActive = entity.slug === activeSlug;
        return (
          <button
            key={entity.slug}
            type="button"
            onClick={() => handleSelect(entity.slug)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              isActive
                ? "bg-white text-lions-blue shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {entity.shortName ?? entity.name}
          </button>
        );
      })}
    </div>
  );
}
