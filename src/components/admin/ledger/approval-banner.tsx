import Link from "next/link";
import type { ApprovalBannerModel } from "@/lib/ledger-approval";
import type { CosignDialogProps } from "./approval-dialog-logic";
import CosignDialog from "./cosign-dialog";

const TONE: Record<ApprovalBannerModel["tone"], string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-green-200 bg-green-50 text-green-900",
  neutral: "border-gray-200 bg-gray-50 text-gray-800",
};

/**
 * The `?txn=` deep-link banner above the tabs. The model's text is plain
 * (payee, reason and decider names are user-typed) and renders as React text,
 * never HTML. `role="status"` so a screen reader announces it on load and after
 * the `router.refresh()` that follows an approve.
 */
export default function ApprovalBanner({
  model,
  cosign,
}: {
  model: ApprovalBannerModel;
  /** Dialog strings for the Add your approval button; shown only when `model.action === "cosign"`. */
  cosign?: CosignDialogProps;
}) {
  return (
    <div
      role="status"
      className={`break-words rounded-2xl border px-4 py-3 text-sm ${TONE[model.tone]}`}
    >
      <p className="whitespace-pre-wrap">{model.text}</p>
      {model.action === "cosign" && cosign ? (
        <div className="mt-3 sm:max-w-xs">
          <CosignDialog {...cosign} />
        </div>
      ) : null}
      {model.linkHref && model.linkLabel ? (
        <p className="mt-2">
          <Link
            href={model.linkHref}
            className="inline-flex min-h-[44px] items-center rounded font-semibold text-lions-blue hover:text-lions-blue-dark hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            {model.linkLabel} &rarr;
          </Link>
        </p>
      ) : null}
    </div>
  );
}
