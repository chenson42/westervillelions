export interface VersionHistoryCitingMinutes {
  id: string;
  label: string;
  status: string;
  href: string;
}

export interface VersionHistoryRow {
  id: string;
  versionNumber: number;
  changeType: string;
  changeNote: string;
  authorName: string | null;
  adoptedByName: string | null;
  adoptedAt: Date | string | null;
  adoptionNote: string | null;
  citingMinutes: VersionHistoryCitingMinutes | null;
  createdAt: Date | string;
  isCurrent: boolean;
  /** True only for a 'substantive' row with `adoptedAt` still null. Members
   *  never see these (the caller already filtered them out of the data),
   *  but the admin caller includes them — this flag is what lets the SAME
   *  component render the "Pending" badge for admins without knowing
   *  anything about who's allowed to see what (DECISION-076 Ruling 6 stays
   *  a data-layer concern, not a component concern). */
  isPending: boolean;
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function ChangeTypeBadge({ changeType }: { changeType: string }) {
  if (changeType === "substantive") {
    return (
      <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
        Substantive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
      Editorial
    </span>
  );
}

/**
 * The three-state label required by Phase 4 requirement 5: a member reading
 * this list must never be unsure whether a row is the current text, a
 * superseded historical version, or (admin-only) a pending amendment.
 */
function StatusBadge({ isCurrent, isPending }: { isCurrent: boolean; isPending: boolean }) {
  if (isPending) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        Pending — not yet in effect
      </span>
    );
  }
  if (isCurrent) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
        Current
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
      Superseded
    </span>
  );
}

/**
 * Pure presentational version-history list — renders whatever rows it's
 * handed; it does not know or care whether the caller is the member-facing
 * data source (pending excluded, DECISION-076 Ruling 6) or the admin one
 * (pending included). Shared by
 * `/members/records/documents/[slug]/history` and `/admin/documents/[slug]`.
 *
 * `compareBasePath` + each row's index build a "View what changed" link to
 * the compare view, defaulting to "this version vs. the version immediately
 * before it in this list" — the same default Phase 3's "Diffing" section
 * specifies for the bare compare page itself. The oldest row in the list
 * has nothing to compare against and gets plain text instead of a link.
 */
export function VersionHistoryList({
  rows,
  compareBasePath,
}: {
  rows: VersionHistoryRow[];
  compareBasePath: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p>No version history yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        const older = rows[i + 1];
        const compareHref = older ? `${compareBasePath}?from=${older.id}&to=${row.id}` : null;

        return (
          <li key={row.id} className="bg-white rounded-2xl shadow-sm overflow-hidden p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Version {row.versionNumber}</span>
              <ChangeTypeBadge changeType={row.changeType} />
              <StatusBadge isCurrent={row.isCurrent} isPending={row.isPending} />
            </div>

            <p className="mt-2 text-sm text-gray-700">{row.changeNote}</p>

            <p className="mt-1 text-xs text-gray-500">
              {row.authorName ? `Recorded by ${row.authorName}` : "Author not recorded"} — {formatDate(row.createdAt)}
            </p>

            {row.adoptedAt && (
              <p className="mt-1 text-xs text-gray-500">
                Adopted{row.adoptedByName ? ` by ${row.adoptedByName}` : ""} on {formatDate(row.adoptedAt)}
                {row.adoptionNote ? ` — "${row.adoptionNote}"` : ""}
              </p>
            )}

            {row.changeType === "substantive" && row.adoptedAt && !row.citingMinutes && (
              <p className="mt-1 text-xs text-amber-700">
                No minutes citation on record yet — normal until the approving meeting has happened.
              </p>
            )}

            {row.citingMinutes && (
              <p className="mt-1 text-xs text-gray-500">
                Cited:{" "}
                <a
                  href={row.citingMinutes.href}
                  className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  {row.citingMinutes.label}
                </a>
                {row.citingMinutes.status !== "approved" ? ` (currently ${row.citingMinutes.status})` : ""}
              </p>
            )}

            {compareHref ? (
              <a
                href={compareHref}
                className="mt-2 inline-flex items-center text-sm font-semibold text-lions-blue hover:text-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                View what changed →
              </a>
            ) : (
              <p className="mt-2 text-xs text-gray-400 italic">First version — nothing to compare.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
