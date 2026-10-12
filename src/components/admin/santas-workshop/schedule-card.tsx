import type { SessionWindow } from "@/lib/santas-workshop/admin-contract";
import { formatLongDate } from "@/lib/santas-workshop/format";
import { Chip } from "./badges";
import { CARD } from "./styles";

/** formatLongDate() already leads with the weekday ("Friday, Dec 18"): never prepend another. */
export function ScheduleCard({
  dropoffDate,
  photoDate,
  pickupDate,
  windows,
}: {
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  windows: SessionWindow[];
}) {
  const rows: [string, string][] = [
    ["Drop-off", dropoffDate],
    ["Photos", photoDate],
    ["Pickup", pickupDate],
  ];
  return (
    <div className={`${CARD} p-6`}>
      <h2 className="text-lg font-semibold text-gray-900">Schedule</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([label, iso]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-medium text-gray-900">{formatLongDate(iso)}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-3 flex flex-wrap gap-2">
        {windows.map((w) => (
          <li key={w.id}>
            <Chip tone="gray">{w.label}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
