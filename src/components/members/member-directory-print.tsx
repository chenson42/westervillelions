import { formatCityStateZip } from "@/lib/member-address";

export interface PrintMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  boardPosition: string | null;
}

interface MemberDirectoryPrintProps {
  members: PrintMember[];
  /** Pre-formatted "August 7, 2026" — computed once server-side in
   *  page.tsx so a page-numbered multi-page print job never shows a
   *  different date on page 2 than page 1. */
  generatedOn: string;
}

/**
 * Printable Member Directory (2026-08-07, Phase 3 design). `hidden
 * print:block` — invisible on screen, shown only when the member clicks
 * "Print Directory / Save as PDF" and the browser's print dialog opens over
 * this markup instead of the interactive MemberDirectory (wrapped in
 * `print:hidden` by the parent page). Mirrors the `budget-print-worksheet.tsx`
 * pattern: a static snapshot built from server-fetched props, never a live
 * client input, so what prints always matches what the treasurer/board
 * expects — no in-progress filter or search state can leak onto the sheet.
 *
 * Layout is a CSS multi-column flow (not a table) per the Phase 1 analyst
 * review: US Letter, 2 columns, no gridlines/zebra striping, alphabetical
 * jump-letters as section anchors, 13pt bold "Last, First" over an 11pt
 * contact block, board position as a small tag under the name. Each entry
 * carries `break-inside-avoid` so it never splits across a column or page
 * break; each jump-letter heading carries `break-after-avoid` so it never
 * strands alone at the bottom of a column.
 *
 * Page numbers: Chromium/WebKit's print engine does not implement CSS Paged
 * Media margin boxes (`@page { @bottom-center }`), so — matching
 * budget-print-worksheet.tsx, which also doesn't attempt this — page
 * numbering relies on the browser's own "Headers and footers" print-dialog
 * option (on by default in Chrome/Edge/Safari), not on anything rendered
 * here.
 */
export function MemberDirectoryPrint({ members, generatedOn }: MemberDirectoryPrintProps) {
  const groups = groupByFirstLetter(members);

  return (
    <div className="hidden print:block text-gray-900">
      <div className="mb-6 border-b-2 border-gray-900 pb-2">
        <h1 className="text-2xl font-bold">Westerville Lions Club</h1>
        <p className="text-sm text-gray-700">Member Directory &bull; Generated {generatedOn}</p>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-gray-600">No active members to display.</p>
      ) : (
        <div className="columns-2 gap-x-10 [column-fill:_auto]">
          {groups.map(([letter, letterMembers]) => (
            <div key={letter}>
              <h2 className="text-sm font-bold text-lions-blue uppercase tracking-widest border-b border-gray-300 pb-0.5 mb-2 break-after-avoid">
                {letter}
              </h2>
              {letterMembers.map((member) => (
                <DirectoryEntry key={member.id} member={member} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryEntry({ member }: { member: PrintMember }) {
  const cityStateZip = formatCityStateZip(member.city, member.state, member.zip);

  return (
    <div className="break-inside-avoid mb-3 pb-2 border-b border-gray-200 last:border-b-0">
      <p className="text-[13pt] font-bold leading-snug">
        {member.lastName}, {member.firstName}
      </p>
      {member.boardPosition && (
        <p className="text-[9pt] font-semibold uppercase tracking-wide text-lions-blue mb-0.5">
          {member.boardPosition}
        </p>
      )}
      {member.email && <p className="text-[11pt] leading-snug">{member.email}</p>}
      {member.phone && <p className="text-[11pt] leading-snug">{member.phone}</p>}
      {member.address && <p className="text-[11pt] leading-snug">{member.address}</p>}
      {cityStateZip && <p className="text-[11pt] leading-snug">{cityStateZip}</p>}
    </div>
  );
}

/** Groups already-sorted (last name, then first name) members into
 *  [letter, members[]] pairs in first-appearance order — the caller's sort
 *  order is trusted, this only buckets it, so grouping is O(n) and never
 *  re-sorts. */
function groupByFirstLetter(members: PrintMember[]): [string, PrintMember[]][] {
  const order: string[] = [];
  const buckets = new Map<string, PrintMember[]>();
  for (const member of members) {
    const letter = (member.lastName[0] ?? "#").toUpperCase();
    if (!buckets.has(letter)) {
      buckets.set(letter, []);
      order.push(letter);
    }
    buckets.get(letter)!.push(member);
  }
  return order.map((letter) => [letter, buckets.get(letter)!]);
}
