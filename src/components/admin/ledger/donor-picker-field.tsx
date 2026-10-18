"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import DonorSearchPanel from "./donor-search-panel";

export interface PickedDonor {
  id: string;
  name: string;
}

interface DonorPickerFieldProps {
  /** The chosen donor, or null when none. */
  donor: PickedDonor | null;
  onChange: (donor: PickedDonor | null) => void;
  /** Disables Choose and Clear while the parent saves. */
  disabled?: boolean;
}

const buttonClass =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60";

/**
 * "Donor (optional)" field for the transaction form: a chip with the chosen
 * donor's name, a Choose donor button that opens the shared DonorSearchPanel in
 * a dialog, and Clear. The donor is saved with the transaction in the same
 * POST; this component never calls the API itself except to search.
 */
export default function DonorPickerField({ donor, onChange, disabled = false }: DonorPickerFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <span id="txn-donor-label" className="block text-sm font-medium text-gray-700 mb-1">
        Donor <span className="text-gray-400 font-normal">(optional)</span>
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="txn-donor-label">
        {donor ? (
          <span
            data-testid="donor-chip"
            className="inline-flex items-center rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm font-medium text-lions-blue min-h-[44px]"
          >
            {donor.name}
          </span>
        ) : (
          <span className="text-sm text-gray-500">No donor chosen</span>
        )}
        <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={buttonClass}>
          {donor ? "Change donor" : "Choose donor"}
        </button>
        {donor && (
          <button type="button" onClick={() => onChange(null)} disabled={disabled} className={buttonClass}>
            Clear
          </button>
        )}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          {/* The picker renders in a portal, but React events bubble through the React
              tree: the create-donor form's submit would otherwise reach the
              transaction form around this field and save the gift early. */}
          <Dialog.Content
            onSubmit={(e) => e.stopPropagation()}
            className="fixed left-1/2 top-1/2 z-[60] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl focus:outline-none max-h-[90vh] overflow-y-auto"
          >
            <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">Choose a donor</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500">
              Pick an existing donor record or create one. The donor is saved with this gift.
            </Dialog.Description>
            <DonorSearchPanel
              active={open}
              currentDonorId={donor?.id ?? null}
              onSelect={(picked) => {
                onChange({ id: picked.id, name: picked.name });
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
