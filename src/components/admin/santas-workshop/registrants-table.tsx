import type { RegistrantDto, SessionKind, SessionStatus } from "@/lib/santas-workshop/admin-contract";
import { displayStuffyName } from "@/lib/santas-workshop/payment-mapper";
import { STATE_LABELS, attentionLabel, needsCheckInPhoto, refundBadge } from "@/lib/santas-workshop/admin-ui";
import { Chip } from "./badges";
import { RegistrantActions } from "./registrant-actions";
import { CARD } from "./styles";

/**
 * Registrants list. Cards below xl, a real table at xl and up, from the same
 * detail fragment: the admin sidebar leaves a wide table clipped until 1280px
 * (the lesson of the approvals page). Every string below came from a buyer or
 * Zeffy and is rendered as a plain React text node, never as HTML.
 */
function Flags({ r }: { r: RegistrantDto }) {
  const refund = refundBadge(r.refund, r.refundedCents);
  return (
    <div className="flex flex-wrap gap-1.5">
      {r.needsAttention && <Chip tone="amber">Needs attention</Chip>}
      {refund && <Chip tone={refund.tone}>{refund.label}</Chip>}
      {r.withdrawn && <Chip tone="gray">Withdrawn</Chip>}
      {needsCheckInPhoto(r) && <Chip tone="amber">No check-in photo</Chip>}
      {r.source === "manual" && <Chip tone="blue">Added by hand</Chip>}
      <Chip tone={r.photoConsent ? "green" : "gray"}>{r.photoConsent ? "Photo sharing OK" : "No photo sharing"}</Chip>
    </div>
  );
}

function Attention({ r }: { r: RegistrantDto }) {
  if (!r.needsAttention) return null;
  return (
    <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <ul className="list-disc pl-5">
        {r.attentionCodes.length === 0 ? <li>Flagged for review</li> : r.attentionCodes.map((c) => <li key={c}>{attentionLabel(c)}</li>)}
      </ul>
      {r.unmatched.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">What the buyer answered to questions not matched yet:</p>
          <dl className="mt-1 space-y-1">
            {r.unmatched.map((u, i) => (
              <div key={i}>
                <dt className="text-amber-800 break-words">{u.question}</dt>
                <dd className="font-medium break-words whitespace-pre-wrap">{u.answer || "(blank)"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Details({ r }: { r: RegistrantDto }) {
  const rows: [string, string | null][] = [
    ["What it is", r.description],
    ["Snack", r.snack || "No snack choice recorded"],
    ["Note to Santa", r.noteToSanta],
    ["Care note", r.careNote],
  ];
  const shown = rows.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1 text-sm">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt className="inline text-gray-500">{k}: </dt>
          <dd className="inline text-gray-900 break-words whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Parent({ r }: { r: RegistrantDto }) {
  const name = [r.parentFirstName, r.parentLastName].filter(Boolean).join(" ");
  return (
    <div className="text-sm text-gray-900 break-words">
      <p className="font-medium">{name || "No parent name"}</p>
      {r.parentEmail && <p className="text-gray-600 break-all">{r.parentEmail}</p>}
      {r.parentPhone && <p className="text-gray-600">{r.parentPhone}</p>}
    </div>
  );
}

export function RegistrantsTable({ registrants, sessionKind, sessionStatus }: { registrants: RegistrantDto[]; sessionKind: SessionKind; sessionStatus: SessionStatus }) {
  return (
    <>
      <ul className="space-y-3 xl:hidden">
        {registrants.map((r) => (
          <li key={r.id} className={`${CARD} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900 break-words">{displayStuffyName(r.name, r.orderSize)}</h3>
              <Chip tone="blue">{STATE_LABELS[r.state]}</Chip>
            </div>
            <p className="text-sm text-gray-500">
              {r.windowLabel ?? "No matching window"}
              {r.tagLast4 ? ` · tag …${r.tagLast4}` : ""}
            </p>
            <div className="mt-2"><Parent r={r} /></div>
            <div className="mt-2"><Flags r={r} /></div>
            <Attention r={r} />
            <Details r={r} />
            <RegistrantActions registrant={r} sessionKind={sessionKind} sessionStatus={sessionStatus} />
          </li>
        ))}
      </ul>

      <div className={`${CARD} hidden xl:block`}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Registered stuffies</caption>
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Stuffy</th>
              <th scope="col" className="px-4 py-3 font-semibold">Parent</th>
              <th scope="col" className="px-4 py-3 font-semibold">Window</th>
              <th scope="col" className="px-4 py-3 font-semibold">Stage</th>
              <th scope="col" className="px-4 py-3 font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 align-top">
            {registrants.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 max-w-md">
                  <p className="font-semibold text-gray-900 break-words">{displayStuffyName(r.name, r.orderSize)}</p>
                  <Details r={r} />
                  <Attention r={r} />
                  <RegistrantActions registrant={r} sessionKind={sessionKind} sessionStatus={sessionStatus} />
                </td>
                <td className="px-4 py-3"><Parent r={r} /></td>
                <td className="px-4 py-3 text-gray-700">{r.windowLabel ?? "No matching window"}</td>
                <td className="px-4 py-3">
                  <Chip tone="blue">{STATE_LABELS[r.state]}</Chip>
                  {r.tagLast4 && <p className="mt-1 text-xs text-gray-500">tag …{r.tagLast4}</p>}
                </td>
                <td className="px-4 py-3"><Flags r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
