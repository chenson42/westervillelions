"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  SESSION_KINDS,
  type CreateSessionRequest,
  type RemapResponse,
  type SessionDto,
  type SessionKind,
  type SessionResponse,
} from "@/lib/santas-workshop/admin-contract";
import { validateCreateSession, validateSessionDates, validateUpdateSession, NAME_MAX, WINDOWS_MAX } from "@/lib/santas-workshop/session-input";
import {
  buildSessionPatch,
  editableOf,
  labelsChanged,
  newWindowId,
  recalculateFromPickup,
  removedWindowIds,
} from "@/lib/santas-workshop/session-edit-patch";
import type { UnmatchedWindowAnswer } from "@/lib/santas-workshop/unmatched-window-answers";
import { formatTimeRange } from "@/lib/santas-workshop/format";
import {
  ADMIN_API,
  KIND_LABELS,
  callAdmin,
  labelChangeNotice,
  remapSummary,
  runRemapLoop,
  slugify,
  suggestSlug,
} from "@/lib/santas-workshop/admin-ui";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, CARD, INPUT, LABEL, LINK } from "./styles";

const KIND_HELP: Record<SessionKind, string> = {
  practice:
    "A dry run for the volunteers. Can be reset to empty at any time, and its photos are removed without waiting.",
  real: "The real event. Registrant data is kept until the retention dates and then removed. This cannot be changed later.",
};

type Props =
  | {
      mode?: "create";
      /** Pre-filled from the WORKSHOP_2026 constant by the server page (defaultSessionDraft). */
      draft: CreateSessionRequest;
    }
  | {
      mode: "edit";
      /** The stored session; kind, slug and ids are shown as text only. */
      session: SessionDto;
      /** Distinct buyer answers that matched no window, offered as one-click labels. */
      unmatchedAnswers: UnmatchedWindowAnswer[];
    };

export function SessionForm(props: Props) {
  if (props.mode === "edit") return <EditSessionForm session={props.session} unmatchedAnswers={props.unmatchedAnswers} />;
  return <CreateSessionForm draft={props.draft} />;
}

function CreateSessionForm({ draft }: { draft: CreateSessionRequest }) {
  const router = useRouter();
  const [kind, setKind] = useState<SessionKind>(draft.kind);
  const [name, setName] = useState(draft.name);
  const [slug, setSlug] = useState(suggestSlug(draft.kind, draft.dropoffDate));
  const [slugTouched, setSlugTouched] = useState(false);
  const [dropoffDate, setDropoffDate] = useState(draft.dropoffDate);
  const [photoDate, setPhotoDate] = useState(draft.photoDate);
  const [pickupDate, setPickupDate] = useState(draft.pickupDate);
  const [windows, setWindows] = useState(draft.windows);
  const [errors, setErrors] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  function chooseKind(next: SessionKind) {
    setKind(next);
    if (!slugTouched) setSlug(suggestSlug(next, dropoffDate));
    // Only swap the default name when the admin has not typed their own.
    if (name === (next === "practice" ? "A Visit to Santa's Workshop" : "Santa's Workshop dry run")) {
      setName(next === "practice" ? "Santa's Workshop dry run" : "A Visit to Santa's Workshop");
    }
  }

  function updateWindow(i: number, patch: Partial<(typeof windows)[number]>) {
    setWindows((ws) =>
      ws.map((w, idx) => {
        if (idx !== i) return w;
        const next = { ...w, ...patch };
        // Keep the label in step with the times until the admin writes their own.
        if ((patch.start !== undefined || patch.end !== undefined) && w.label === formatTimeRange(w.start, w.end) && next.start && next.end) {
          next.label = formatTimeRange(next.start, next.end);
        }
        return next;
      }),
    );
  }

  function addWindow() {
    setWindows((ws) => {
      const last = ws[ws.length - 1];
      const start = last?.end ?? "16:00";
      const [h, m] = start.split(":").map(Number);
      const end = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return [...ws, { id: newWindowId(ws), label: formatTimeRange(start, end), start, end }];
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors(null);
    const body: CreateSessionRequest = { name, slug, kind, dropoffDate, photoDate, pickupDate, windows };
    const checked = validateCreateSession(body);
    if (!checked.ok) {
      setErrors({ field: checked.field, message: checked.error });
      return;
    }
    setPending(true);
    const res = await callAdmin<SessionResponse>(ADMIN_API.sessions, { method: "POST", body: JSON.stringify(checked.value) });
    setPending(false);
    if (!res.ok) {
      setErrors({ field: res.failure.field, message: res.failure.message });
      return;
    }
    toast.success("Session created.");
    router.push(`/admin/santas-workshop/${res.data.session.id}`);
    router.refresh();
  }

  const fieldError = (f: string) => (errors?.field === f ? errors.message : null);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <fieldset className={`${CARD} p-6`}>
        <legend className="px-1 text-lg font-semibold text-gray-900">What kind of session is this?</legend>
        <p className="mt-1 text-sm text-gray-600">Pick carefully: this is fixed once the session is created.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SESSION_KINDS.map((k) => (
            <label
              key={k}
              className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4 focus-within:ring-2 focus-within:ring-lions-blue ${
                kind === k ? "border-lions-blue bg-lions-blue/5" : "border-gray-200"
              }`}
            >
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => chooseKind(k)} className="mt-1 h-5 w-5" />
              <span>
                <span className="block font-semibold text-gray-900">{KIND_LABELS[k]}</span>
                <span className="block text-sm text-gray-600">{KIND_HELP[k]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className={`${CARD} p-6 space-y-4`}>
        <div>
          <label htmlFor="sw-name" className={LABEL}>Session name</label>
          <input id="sw-name" className={INPUT} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldError("name")} aria-describedby={fieldError("name") ? "sw-name-err" : undefined} />
          {fieldError("name") && <p id="sw-name-err" className="mt-1 text-sm text-red-700">{fieldError("name")}</p>}
        </div>
        <div>
          <label htmlFor="sw-slug" className={LABEL}>Short name for web addresses</label>
          <input
            id="sw-slug"
            className={INPUT}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            aria-invalid={!!fieldError("slug")}
            aria-describedby="sw-slug-help"
          />
          <p id="sw-slug-help" className="mt-1 text-sm text-gray-500">3 to 40 lowercase letters, numbers and hyphens. Used in the worker link. Fixed once created.</p>
          {fieldError("slug") && <p className="mt-1 text-sm text-red-700">{fieldError("slug")}</p>}
        </div>
      </section>

      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Dates</h2>
        <p className="mt-1 text-sm text-gray-600">Starting values come from the club&rsquo;s 2026 event facts. Change them here for another year or a dry run.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["dropoffDate", "Drop-off day", dropoffDate, setDropoffDate],
              ["photoDate", "Photo day", photoDate, setPhotoDate],
              ["pickupDate", "Pickup day", pickupDate, setPickupDate],
            ] as const
          ).map(([field, label, value, set]) => (
            <div key={field}>
              <label htmlFor={`sw-${field}`} className={LABEL}>{label}</label>
              <input id={`sw-${field}`} type="date" className={INPUT} value={value} onChange={(e) => set(e.target.value)} aria-invalid={!!fieldError(field)} />
              {fieldError(field) && <p className="mt-1 text-sm text-red-700">{fieldError(field)}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Drop-off windows</h2>
        <p className="mt-1 text-sm text-gray-600">Eastern time. A buyer picks one on the Zeffy form; the label must match what the form says (not case-sensitive).</p>
        <ul className="mt-4 space-y-4">
          {windows.map((w, i) => (
            <li key={w.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
                <div>
                  <label htmlFor={`sw-w-label-${i}`} className={LABEL}>Label</label>
                  <input id={`sw-w-label-${i}`} className={INPUT} value={w.label} onChange={(e) => updateWindow(i, { label: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`sw-w-start-${i}`} className={LABEL}>Starts</label>
                  <input id={`sw-w-start-${i}`} type="time" className={INPUT} value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`sw-w-end-${i}`} className={LABEL}>Ends</label>
                  <input id={`sw-w-end-${i}`} type="time" className={INPUT} value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })} />
                </div>
                <button type="button" className={BTN_SMALL} disabled={windows.length <= 1} onClick={() => setWindows((ws) => ws.filter((_, idx) => idx !== i))} aria-label={`Remove window ${w.label}`}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {fieldError("windows") && <p className="mt-2 text-sm text-red-700">{fieldError("windows")}</p>}
        <button type="button" className={`${BTN_SECONDARY} mt-4`} onClick={addWindow} disabled={windows.length >= WINDOWS_MAX}>
          Add a window
        </button>
      </section>

      {errors && !errors.field && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{errors.message}</p>
      )}
      {errors?.field && !["name", "slug", "dropoffDate", "photoDate", "pickupDate", "windows"].includes(errors.field) && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{errors.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={BTN_PRIMARY} disabled={pending}>
          {pending ? "Creating…" : `Create ${kind} session`}
        </button>
        <Link href="/admin/santas-workshop" className={LINK}>Cancel</Link>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

function EditSessionForm({ session, unmatchedAnswers }: { session: SessionDto; unmatchedAnswers: UnmatchedWindowAnswer[] }) {
  const router = useRouter();
  const [base, setBase] = useState(() => editableOf(session));
  const [form, setForm] = useState(() => editableOf(session));
  const [lastLabel, setLastLabel] = useState(0);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [needsRemap, setNeedsRemap] = useState<string | null>(null);
  const [remapping, setRemapping] = useState(false);
  const [remapResult, setRemapResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const patch = buildSessionPatch(base, form);
  const dirty = Object.keys(patch).length > 0;
  const removed = removedWindowIds(base, form);
  const fieldError = (f: string) => (error?.field === f ? error.message : null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function updateWindow(i: number, p: Partial<(typeof form.windows)[number]>) {
    setForm((f) => ({
      ...f,
      windows: f.windows.map((w, idx) => {
        if (idx !== i) return w;
        const next = { ...w, ...p };
        if ((p.start !== undefined || p.end !== undefined) && w.label === formatTimeRange(w.start, w.end) && next.start && next.end) {
          next.label = formatTimeRange(next.start, next.end);
        }
        return next;
      }),
    }));
  }

  function addWindow() {
    setForm((f) => {
      const last = f.windows[f.windows.length - 1];
      const start = last?.end ?? "16:00";
      const [h, m] = start.split(":").map(Number);
      const end = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return { ...f, windows: [...f.windows, { id: newWindowId(f.windows), label: formatTimeRange(start, end), start, end }] };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsRemap(null);
    setRemapResult(null);
    if (!dirty) return;
    const checked = validateUpdateSession(patch);
    if (!checked.ok) {
      setError({ field: checked.field, message: checked.error });
      return;
    }
    const dates = validateSessionDates(form);
    if (!dates.ok) {
      setError({ field: dates.field, message: dates.error });
      return;
    }
    setPending(true);
    const res = await callAdmin<SessionResponse>(ADMIN_API.session(session.id), { method: "PATCH", body: JSON.stringify(checked.value) });
    setPending(false);
    if (!res.ok) {
      setError({ field: res.failure.field, message: res.failure.message });
      return;
    }
    const changedLabels = labelsChanged(base, form);
    const saved = editableOf(res.data.session);
    setBase(saved);
    setForm(saved);
    toast.success("Session saved.");
    setNeedsRemap(labelChangeNotice(changedLabels));
    router.refresh();
  }

  async function remap() {
    setRemapping(true);
    setRemapResult(null);
    const out = await runRemapLoop({
      post: (cursor) => callAdmin<RemapResponse>(ADMIN_API.remap(session.id), { method: "POST", body: JSON.stringify({ cursor }) }),
    });
    setRemapping(false);
    if (out.status === "error") setRemapResult({ tone: "error", text: `${out.failure.message} ${remapSummary(out.processed, out.changed)}` });
    else {
      setRemapResult({ tone: "ok", text: remapSummary(out.processed, out.changed) });
      setNeedsRemap(null);
      toast.success("Registrants re-read.");
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Fixed once created</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Kind</dt>
            <dd className="font-medium text-gray-900">{KIND_LABELS[session.kind]}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Short name for web addresses</dt>
            <dd className="font-medium text-gray-900 break-all">{session.slug}</dd>
          </div>
        </dl>
      </section>

      <section className={`${CARD} p-6`}>
        <label htmlFor="sw-name" className={LABEL}>Session name</label>
        <input id="sw-name" className={INPUT} value={form.name} maxLength={NAME_MAX} onChange={(e) => set("name", e.target.value)} aria-invalid={!!fieldError("name")} />
        {fieldError("name") && <p className="mt-1 text-sm text-red-700">{fieldError("name")}</p>}
      </section>

      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Dates</h2>
        {session.status !== "draft" && (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            The public page and the Zeffy form text carry these dates too; update them separately. This page changes only the session.
          </p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["dropoffDate", "Drop-off day"],
              ["photoDate", "Photo day"],
              ["pickupDate", "Pickup day"],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`sw-${field}`} className={LABEL}>{label}</label>
              <input id={`sw-${field}`} type="date" className={INPUT} value={form[field]} onChange={(e) => set(field, e.target.value)} aria-invalid={!!fieldError(field)} />
              {fieldError(field) && <p className="mt-1 text-sm text-red-700">{fieldError(field)}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Worker access and removal dates</h2>
        <p className="mt-1 text-sm text-gray-600">
          Changing the pickup day does not move these by itself. Recalculate proposes new ones; review them before saving.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["crewClosesOn", "Worker access closes"],
              ["purgePersonalOn", "Remove personal details on"],
              ["purgePublicOn", "Remove public photos on"],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`sw-${field}`} className={LABEL}>{label}</label>
              <input id={`sw-${field}`} type="date" className={INPUT} value={form[field]} onChange={(e) => set(field, e.target.value)} aria-invalid={!!fieldError(field)} />
              {fieldError(field) && <p className="mt-1 text-sm text-red-700">{fieldError(field)}</p>}
            </div>
          ))}
        </div>
        <button type="button" className={`${BTN_SECONDARY} mt-4`} onClick={() => setForm((f) => ({ ...f, ...recalculateFromPickup(f.pickupDate) }))}>
          Recalculate worker access and removal dates from pickup day
        </button>
      </section>

      <section className={`${CARD} p-6`}>
        <h2 className="text-lg font-semibold text-gray-900">Drop-off windows</h2>
        <p className="mt-1 text-sm text-gray-600">
          A window&rsquo;s label must read exactly as the Zeffy form&rsquo;s answer does (capitals and spacing do not matter). Registrants who already chose a
          window keep it when you change its label.
        </p>

        {unmatchedAnswers.length > 0 && (
          <div className="mt-4 rounded-2xl bg-amber-50 p-4" role="group" aria-labelledby="unmatched-heading">
            <h3 id="unmatched-heading" className="font-semibold text-amber-900">Answers that matched no window</h3>
            <p className="mt-1 text-sm text-amber-900">
              Choose one to use it as the label of the window you edited last ({form.windows[lastLabel]?.label ?? "the first window"}).
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {unmatchedAnswers.map((u) => (
                <li key={u.answer}>
                  <button
                    type="button"
                    className="min-h-[44px] rounded-full border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-lions-blue break-all"
                    onClick={() => updateWindow(Math.min(lastLabel, form.windows.length - 1), { label: u.answer })}
                  >
                    {u.answer} <span className="text-gray-500">({u.count} order{u.count === 1 ? "" : "s"})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="mt-4 space-y-4">
          {form.windows.map((w, i) => (
            <li key={w.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
                <div>
                  <label htmlFor={`sw-w-label-${i}`} className={LABEL}>Label</label>
                  <input id={`sw-w-label-${i}`} className={INPUT} value={w.label} onFocus={() => setLastLabel(i)} onChange={(e) => updateWindow(i, { label: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`sw-w-start-${i}`} className={LABEL}>Starts</label>
                  <input id={`sw-w-start-${i}`} type="time" className={INPUT} value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`sw-w-end-${i}`} className={LABEL}>Ends</label>
                  <input id={`sw-w-end-${i}`} type="time" className={INPUT} value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })} />
                </div>
                <button
                  type="button"
                  className={BTN_SMALL}
                  disabled={form.windows.length <= 1}
                  onClick={() => setForm((f) => ({ ...f, windows: f.windows.filter((_, idx) => idx !== i) }))}
                  aria-label={`Remove window ${w.label}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {removed.length > 0 && <p className="mt-2 text-sm text-amber-800">Removing a window that registrants chose is refused; change its label instead.</p>}
        {fieldError("windows") && <p role="alert" className="mt-2 text-sm text-red-700">{fieldError("windows")}</p>}
        <button type="button" className={`${BTN_SECONDARY} mt-4`} onClick={addWindow} disabled={form.windows.length >= WINDOWS_MAX}>
          Add a window
        </button>
      </section>

      {error && !error.field && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error.message}</p>}
      {error?.field && !["name", "dropoffDate", "photoDate", "pickupDate", "crewClosesOn", "purgePersonalOn", "purgePublicOn", "windows"].includes(error.field) && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error.message}</p>
      )}

      {needsRemap && (
        <div role="status" className="rounded-2xl bg-lions-blue/5 p-4 text-sm text-gray-900 space-y-3">
          <p>{needsRemap}</p>
          <button type="button" className={BTN_PRIMARY} onClick={remap} disabled={remapping}>
            {remapping ? "Re-reading…" : "Run Remap now"}
          </button>
        </div>
      )}
      {remapResult && (
        <p role={remapResult.tone === "error" ? "alert" : "status"} className={`rounded-lg p-4 text-sm ${remapResult.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {remapResult.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={BTN_PRIMARY} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/admin/santas-workshop/${session.id}`} className={LINK}>Back to overview</Link>
      </div>
    </form>
  );
}
