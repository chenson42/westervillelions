"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Single scrolling proposal form — three labeled sections (The Project /
 * Money / Help Needed), NOT a wizard (Phase 3 explicit ruling — a wizard
 * multiplies navigation disorientation for the older-adult audience this
 * form was researched and simplified for).
 *
 * Hand-rolled useState + fetch, no react-hook-form (architect ruled against
 * it — see docs/work-log/2026-08-09-project-proposal-form.md Phase 2 §3).
 * Radio buttons (not <select>) for `type` and `moneyNeeded` per the
 * accessibility research; 16px+ body text; 44px+ tap targets; every
 * required field marked with the literal word "Required", every optional
 * one dual-marked "(optional)".
 *
 * Debounced autosave (~2s) PATCHes the draft's own route once an id exists;
 * the first meaningful edit fires the POST that mints the id. An explicit
 * "Save Draft"/"Save Changes" button forces an immediate flush. Every save
 * (autosave or explicit) sends the FULL current form state, not a partial
 * diff — this guarantees every tri-state value+unknown pair is always sent
 * together, per api-developer's handoff note, rather than relying on the
 * server's merge-and-reject as the normal path.
 */

const PROJECT_NAME_MAX = 200;
const NEED_DESCRIPTION_MAX = 3000;
const CHAIR_NAME_MAX = 200;
const CLUB_RESOURCES_MAX = 2000;
const PUBLICITY_PLAN_MAX = 2000;
const ADDITIONAL_NOTES_MAX = 2000;

export interface ProposalFormInitial {
  id: string;
  status: string;
  projectName: string | null;
  type: string | null;
  needDescription: string | null;
  chairName: string | null;
  moneyNeeded: string | null;
  estimatedCostCents: number | null;
  estimatedCostUnknown: boolean;
  estimatedIncomeCents: number | null;
  estimatedIncomeUnknown: boolean;
  proposedDate: string | null;
  proposedDateUnknown: boolean;
  volunteersNeeded: number | null;
  volunteersNeededUnknown: boolean;
  clubResourcesNeeded: string | null;
  publicityPlan: string | null;
  additionalNotes: string | null;
  submittedAt: string | null;
}

interface ProposalFormProps {
  /** null for a brand-new proposal — no id has been minted yet. */
  proposal: ProposalFormInitial | null;
  proposerName: string;
  proposerEmail: string;
  proposerPhone: string | null;
}

function centsToDollarString(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

function dollarStringToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  if (isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

function formatSubmittedDate(iso: string | null): string {
  if (!iso) return "Not yet submitted";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-base font-semibold text-gray-800 mb-1.5">
      {children}{" "}
      {required ? (
        <span className="text-red-600 font-normal text-sm align-middle">Required</span>
      ) : (
        <span className="text-gray-400 font-normal text-sm align-middle">(optional)</span>
      )}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-sm text-red-600" role="alert">
      {message}
    </p>
  );
}

function RadioOption({
  id,
  name,
  value,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer transition focus-within:ring-2 focus-within:ring-lions-blue ${
        checked ? "border-lions-blue bg-lions-blue/5" : "border-gray-300 hover:bg-gray-50"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 h-5 w-5 flex-shrink-0 text-lions-blue focus:outline-none"
      />
      <span>
        <span className="block text-base font-medium text-gray-900">{label}</span>
        {description && <span className="block text-sm text-gray-500 mt-0.5">{description}</span>}
      </span>
    </label>
  );
}

function UnknownCheckbox({
  id,
  checked,
  onChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-base text-gray-700"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-5 w-5 flex-shrink-0 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
      />
      {label}
    </label>
  );
}

const inputClass =
  "block w-full min-h-[44px] rounded-lg border border-gray-300 py-2.5 px-3 text-base text-gray-900 focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60 disabled:bg-gray-50";

function SaveStateIndicator({ state }: { state: "idle" | "dirty" | "saving" | "saved" | "error" }) {
  if (state === "saving") return <p className="text-sm text-gray-500">Saving…</p>;
  if (state === "dirty") return <p className="text-sm text-gray-500">Unsaved changes</p>;
  if (state === "saved") return <p className="text-sm text-green-700">All changes saved</p>;
  if (state === "error") return <p className="text-sm text-red-600">Couldn&rsquo;t save — check your connection</p>;
  return <p className="text-sm text-gray-400">&nbsp;</p>;
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export function ProposalForm({ proposal, proposerName, proposerEmail, proposerPhone }: ProposalFormProps) {
  const router = useRouter();

  const [id, setId] = useState<string | null>(proposal?.id ?? null);
  const [status, setStatus] = useState<string>(proposal?.status ?? "draft");
  const [submittedAt, setSubmittedAt] = useState<string | null>(proposal?.submittedAt ?? null);

  const [projectName, setProjectName] = useState(proposal?.projectName ?? "");
  const [type, setType] = useState(proposal?.type ?? "");
  const [needDescription, setNeedDescription] = useState(proposal?.needDescription ?? "");
  const [chairName, setChairName] = useState(proposal?.chairName ?? "");
  const [moneyNeeded, setMoneyNeeded] = useState(proposal?.moneyNeeded ?? "");

  const [costAmount, setCostAmount] = useState(centsToDollarString(proposal?.estimatedCostCents ?? null));
  const [costUnknown, setCostUnknown] = useState(proposal?.estimatedCostUnknown ?? false);

  const [incomeAmount, setIncomeAmount] = useState(centsToDollarString(proposal?.estimatedIncomeCents ?? null));
  const [incomeUnknown, setIncomeUnknown] = useState(proposal?.estimatedIncomeUnknown ?? false);

  const [proposedDate, setProposedDate] = useState(proposal?.proposedDate ?? "");
  const [dateUnknown, setDateUnknown] = useState(proposal?.proposedDateUnknown ?? false);

  const [volunteers, setVolunteers] = useState(
    proposal?.volunteersNeeded !== null && proposal?.volunteersNeeded !== undefined
      ? String(proposal.volunteersNeeded)
      : "",
  );
  const [volunteersUnknown, setVolunteersUnknown] = useState(proposal?.volunteersNeededUnknown ?? false);

  const [clubResources, setClubResources] = useState(proposal?.clubResourcesNeeded ?? "");
  const [publicityPlan, setPublicityPlan] = useState(proposal?.publicityPlan ?? "");
  const [additionalNotes, setAdditionalNotes] = useState(proposal?.additionalNotes ?? "");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const isFirstRender = useRef(true);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const idRef = useRef(id);
  idRef.current = id;
  const lockedRef = useRef(lockedMessage);
  lockedRef.current = lockedMessage;

  function buildPayload() {
    return {
      projectName: projectName.trim() || null,
      type: type || null,
      needDescription: needDescription.trim() || null,
      chairName: chairName.trim() || null,
      moneyNeeded: moneyNeeded || null,
      estimatedCostCents: costUnknown ? null : dollarStringToCents(costAmount),
      estimatedCostUnknown: costUnknown,
      estimatedIncomeCents: incomeUnknown ? null : dollarStringToCents(incomeAmount),
      estimatedIncomeUnknown: incomeUnknown,
      proposedDate: dateUnknown ? null : proposedDate || null,
      proposedDateUnknown: dateUnknown,
      volunteersNeeded: volunteersUnknown ? null : volunteers.trim() ? Math.max(0, parseInt(volunteers, 10) || 0) : null,
      volunteersNeededUnknown: volunteersUnknown,
      clubResourcesNeeded: clubResources.trim() || null,
      publicityPlan: publicityPlan.trim() || null,
      additionalNotes: additionalNotes.trim() || null,
    };
  }

  /**
   * Promise-based mutex, not a boolean flag. A caller that arrives while a
   * save is already in flight AWAITS that save, then issues its own fresh
   * save with whatever the current field state is — it never bails out
   * early. An earlier boolean-flag version returned `false` immediately to
   * any overlapping caller (queuing a background retry that the original
   * caller never saw), which meant clicking "Submit" while the debounced
   * autosave was still in flight could spuriously report "could not save"
   * and never reach the submit endpoint at all, even though the data was
   * perfectly valid. Found via a full click-through during Phase 4 QA.
   */
  async function persist(): Promise<boolean> {
    if (lockedRef.current) return false;
    if (savingPromiseRef.current) {
      await savingPromiseRef.current.catch(() => {});
      return persist();
    }
    const run = persistOnce();
    savingPromiseRef.current = run;
    try {
      return await run;
    } finally {
      savingPromiseRef.current = null;
    }
  }

  async function persistOnce(): Promise<boolean> {
    setSaveState("saving");
    try {
      const payload = buildPayload();
      const wasNew = !idRef.current;
      const res = idRef.current
        ? await fetch(`/api/members/proposals/${idRef.current}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/members/proposals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setLockedMessage(data.error || "This proposal is locked for review and can no longer be edited.");
        setSaveState("error");
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not save your changes.");
      }
      const data = await res.json();
      if (wasNew) {
        setId(data.proposal.id);
        idRef.current = data.proposal.id;
        // The URL still reads /members/proposals/new even though a real
        // draft row now exists — replace it so a page reload resumes this
        // draft instead of silently starting a second, orphaned one.
        router.replace(`/members/proposals/${data.proposal.id}`);
      }
      setStatus(data.proposal.status);
      setSaveState("saved");
      return true;
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof Error ? err.message : "Could not save your changes. Check your connection.");
      return false;
    }
  }

  // Debounced autosave (~2s after the last change to any field). Skips the
  // initial mount so opening an already-saved proposal doesn't immediately
  // re-PATCH it with identical data.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (lockedRef.current) return;
    setSaveState("dirty");
    const timer = setTimeout(() => {
      persist();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectName,
    type,
    needDescription,
    chairName,
    moneyNeeded,
    costAmount,
    costUnknown,
    incomeAmount,
    incomeUnknown,
    proposedDate,
    dateUnknown,
    volunteers,
    volunteersUnknown,
    clubResources,
    publicityPlan,
    additionalNotes,
  ]);

  async function handleSaveNow() {
    const ok = await persist();
    if (ok) toast.success(status === "draft" ? "Draft saved." : "Changes saved.");
  }

  function validateClientSide(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!projectName.trim()) errors.projectName = "Project or activity name is required";
    if (!type) errors.type = "Type is required — choose Fundraiser, Service Project, or Both";
    if (!needDescription.trim())
      errors.needDescription = "Please describe the need this meets and how it helps the community";
    if (!chairName.trim())
      errors.chairName =
        'Chairperson is required — enter a name, or "Not yet identified" if no one has stepped forward yet';
    if (!moneyNeeded) {
      errors.moneyNeeded = "Please answer whether this will need money from the club up front";
    } else if (moneyNeeded === "yes" && !costUnknown && dollarStringToCents(costAmount) === null) {
      errors.estimatedCostCents = 'Enter an estimated cost, or mark it "not sure yet"';
    }
    return errors;
  }

  async function handleSubmit() {
    const errors = validateClientSide();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error("Please fill in the required fields, highlighted below.");
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const saved = await persist();
      if (!saved) {
        toast.error("Could not save your latest changes before submitting. Please try again.");
        return;
      }
      const targetId = idRef.current;
      const res = await fetch(`/api/members/proposals/${targetId}/submit`, { method: "POST" });

      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        setFieldErrors(data.errors || {});
        toast.error("Please fix the highlighted fields and submit again.");
        return;
      }
      if (res.status === 409) {
        toast.success("This proposal has already been submitted.");
        router.refresh();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not submit your proposal. Please try again.");
      }
      const data = await res.json();
      setStatus(data.proposal.status);
      setSubmittedAt(data.proposal.submittedAt);
      toast.success("Proposal submitted! The board will review it at their next meeting.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit your proposal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDiscard() {
    if (!idRef.current) return;
    setDiscarding(true);
    try {
      const res = await fetch(`/api/members/proposals/${idRef.current}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not discard this draft.");
      }
      toast.success("Draft discarded.");
      router.push("/members/proposals");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not discard this draft.");
    } finally {
      setDiscarding(false);
      setDiscardOpen(false);
    }
  }

  const isDraft = status === "draft";
  const showIncome = type === "fundraiser" || type === "both";
  const showCost = moneyNeeded === "yes";
  const disabled = !!lockedMessage;

  return (
    <div className="space-y-8">
      {lockedMessage && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-800">
          {lockedMessage}
        </div>
      )}

      {/* Auto-filled, read-only proposer info — retires 4 of the paper
          form's 18 items (Phase 3 "Agreed field set"). */}
      <div className="grid gap-x-6 gap-y-2 rounded-2xl bg-gray-50 p-5 text-base text-gray-600 sm:grid-cols-2">
        <div>
          <span className="font-semibold text-gray-700">Proposed by: </span>
          {proposerName}
        </div>
        <div>
          <span className="font-semibold text-gray-700">Email: </span>
          {proposerEmail}
        </div>
        {proposerPhone && (
          <div>
            <span className="font-semibold text-gray-700">Phone: </span>
            {proposerPhone}
          </div>
        )}
        <div>
          <span className="font-semibold text-gray-700">Submitted: </span>
          {formatSubmittedDate(submittedAt)}
        </div>
      </div>

      {/* Section 1 — The Project */}
      <section className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-5">
        <h2 className="text-xl font-bold text-gray-900">The Project</h2>

        <div>
          <FieldLabel htmlFor="proposal-name" required>
            Project or activity name
          </FieldLabel>
          <input
            id="proposal-name"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            maxLength={PROJECT_NAME_MAX}
            disabled={disabled}
            className={inputClass}
            placeholder="e.g., Rudolph Run, Holiday Food Drive"
          />
          <FieldError message={fieldErrors.projectName} />
        </div>

        <fieldset>
          <legend className="block text-base font-semibold text-gray-800 mb-1.5">
            Type <span className="text-red-600 font-normal text-sm align-middle">Required</span>
          </legend>
          <div className="space-y-2">
            <RadioOption
              id="proposal-type-fundraiser"
              name="proposal-type"
              value="fundraiser"
              checked={type === "fundraiser"}
              onChange={() => setType("fundraiser")}
              label="Fundraiser"
              disabled={disabled}
            />
            <RadioOption
              id="proposal-type-service"
              name="proposal-type"
              value="service_project"
              checked={type === "service_project"}
              onChange={() => setType("service_project")}
              label="Service Project"
              disabled={disabled}
            />
            <RadioOption
              id="proposal-type-both"
              name="proposal-type"
              value="both"
              checked={type === "both"}
              onChange={() => setType("both")}
              label="Both"
              disabled={disabled}
            />
          </div>
          <FieldError message={fieldErrors.type} />
        </fieldset>

        <div>
          <FieldLabel htmlFor="proposal-need" required>
            What need does this meet, and how does it help the community?
          </FieldLabel>
          <textarea
            id="proposal-need"
            value={needDescription}
            onChange={(e) => setNeedDescription(e.target.value)}
            rows={4}
            maxLength={NEED_DESCRIPTION_MAX}
            disabled={disabled}
            placeholder="A couple of sentences is plenty."
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-sm text-gray-400">
            {needDescription.length}/{NEED_DESCRIPTION_MAX} characters
          </p>
          <FieldError message={fieldErrors.needDescription} />
        </div>

        <div>
          <FieldLabel htmlFor="proposal-chair" required>
            Who will chair it?
          </FieldLabel>
          <input
            id="proposal-chair"
            type="text"
            value={chairName}
            onChange={(e) => setChairName(e.target.value)}
            maxLength={CHAIR_NAME_MAX}
            disabled={disabled}
            className={inputClass}
            placeholder='A name, or "Not yet identified"'
          />
          <p className="mt-1 text-sm text-gray-400">
            No one lined up yet? Type &ldquo;Not yet identified&rdquo; — that&rsquo;s a valid answer and the board
            can help find a chair.
          </p>
          <FieldError message={fieldErrors.chairName} />
        </div>
      </section>

      {/* Section 2 — Money */}
      <section className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-5">
        <h2 className="text-xl font-bold text-gray-900">Money</h2>

        <fieldset>
          <legend className="block text-base font-semibold text-gray-800 mb-1.5">
            Will this need money from the club up front?{" "}
            <span className="text-red-600 font-normal text-sm align-middle">Required</span>
          </legend>
          <div className="space-y-2">
            <RadioOption
              id="proposal-money-yes"
              name="proposal-money"
              value="yes"
              checked={moneyNeeded === "yes"}
              onChange={() => setMoneyNeeded("yes")}
              label="Yes"
              disabled={disabled}
            />
            <RadioOption
              id="proposal-money-no"
              name="proposal-money"
              value="no"
              checked={moneyNeeded === "no"}
              onChange={() => setMoneyNeeded("no")}
              label="No"
              disabled={disabled}
            />
            <RadioOption
              id="proposal-money-notsure"
              name="proposal-money"
              value="not_sure"
              checked={moneyNeeded === "not_sure"}
              onChange={() => setMoneyNeeded("not_sure")}
              label="Not sure"
              disabled={disabled}
            />
          </div>
          <FieldError message={fieldErrors.moneyNeeded} />
        </fieldset>

        {showCost && (
          <div>
            <FieldLabel htmlFor="proposal-cost" required>
              Estimated cost
            </FieldLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 select-none text-base text-gray-400">$</span>
              <input
                id="proposal-cost"
                type="number"
                min="0"
                step="0.01"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
                disabled={disabled || costUnknown}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
            <UnknownCheckbox
              id="proposal-cost-unknown"
              checked={costUnknown}
              onChange={(checked) => {
                setCostUnknown(checked);
                if (checked) setCostAmount("");
              }}
              label="Not sure yet"
              disabled={disabled}
            />
            <FieldError message={fieldErrors.estimatedCostCents} />
          </div>
        )}

        {showIncome && (
          <div>
            <FieldLabel htmlFor="proposal-income">Estimated income</FieldLabel>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 select-none text-base text-gray-400">$</span>
              <input
                id="proposal-income"
                type="number"
                min="0"
                step="0.01"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
                disabled={disabled || incomeUnknown}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
            <UnknownCheckbox
              id="proposal-income-unknown"
              checked={incomeUnknown}
              onChange={(checked) => {
                setIncomeUnknown(checked);
                if (checked) setIncomeAmount("");
              }}
              label="Not sure yet"
              disabled={disabled}
            />
          </div>
        )}

        <div>
          <FieldLabel htmlFor="proposal-date">When would this happen?</FieldLabel>
          <input
            id="proposal-date"
            type="date"
            value={proposedDate}
            onChange={(e) => setProposedDate(e.target.value)}
            disabled={disabled || dateUnknown}
            className={inputClass}
          />
          <UnknownCheckbox
            id="proposal-date-unknown"
            checked={dateUnknown}
            onChange={(checked) => {
              setDateUnknown(checked);
              if (checked) setProposedDate("");
            }}
            label="Not sure yet"
            disabled={disabled}
          />
        </div>
      </section>

      {/* Section 3 — Help Needed */}
      <section className="bg-white rounded-2xl shadow-sm overflow-hidden p-6 space-y-5">
        <h2 className="text-xl font-bold text-gray-900">Help Needed</h2>

        <div>
          <FieldLabel htmlFor="proposal-volunteers">Roughly how many volunteers?</FieldLabel>
          <input
            id="proposal-volunteers"
            type="number"
            min="0"
            step="1"
            value={volunteers}
            onChange={(e) => setVolunteers(e.target.value)}
            disabled={disabled || volunteersUnknown}
            className={inputClass}
            placeholder="e.g., 6"
          />
          <UnknownCheckbox
            id="proposal-volunteers-unknown"
            checked={volunteersUnknown}
            onChange={(checked) => {
              setVolunteersUnknown(checked);
              if (checked) setVolunteers("");
            }}
            label="Not sure yet"
            disabled={disabled}
          />
        </div>

        <div>
          <FieldLabel htmlFor="proposal-resources">What would you need from the club?</FieldLabel>
          <textarea
            id="proposal-resources"
            value={clubResources}
            onChange={(e) => setClubResources(e.target.value)}
            rows={3}
            maxLength={CLUB_RESOURCES_MAX}
            disabled={disabled}
            placeholder="Equipment, technology, meeting space, volunteers from other committees…"
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <FieldLabel htmlFor="proposal-publicity">How should we publicize this?</FieldLabel>
          <textarea
            id="proposal-publicity"
            value={publicityPlan}
            onChange={(e) => setPublicityPlan(e.target.value)}
            rows={3}
            maxLength={PUBLICITY_PLAN_MAX}
            disabled={disabled}
            placeholder="To club members, the community, or both"
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <FieldLabel htmlFor="proposal-notes">Anything else?</FieldLabel>
          <textarea
            id="proposal-notes"
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={3}
            maxLength={ADDITIONAL_NOTES_MAX}
            disabled={disabled}
            className={`${inputClass} resize-none`}
          />
        </div>
      </section>

      {/* Save state + actions */}
      <div className="flex flex-col gap-4 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <SaveStateIndicator state={saveState} />
        <div className="flex flex-wrap gap-3">
          {isDraft && id && (
            <button
              type="button"
              onClick={() => setDiscardOpen(true)}
              disabled={disabled || discarding}
              className="min-h-[44px] rounded-lg px-3 py-2 text-base font-medium text-gray-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-60"
            >
              Discard Draft
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveNow}
            disabled={disabled}
            className="min-h-[44px] rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
          >
            {isDraft ? "Save Draft" : "Save Changes"}
          </button>
          {isDraft && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled || submitting}
              className="min-h-[44px] rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit Proposal"}
            </button>
          )}
        </div>
      </div>

      {!isDraft && status === "submitted" && (
        <p className="text-base text-gray-500">
          Submitted — the board reviews proposals at its next meeting. You can keep editing until a reviewer begins
          looking at it.
        </p>
      )}

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this draft?"
        description="This will permanently delete this draft proposal. This cannot be undone."
        confirmLabel="Discard Draft"
        destructive
        onConfirm={handleDiscard}
      />
    </div>
  );
}
