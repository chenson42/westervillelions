/**
 * Bank Transition — Chase Account Ownership (guide §1)
 *
 * Club/bank operational process, not app behavior — explicitly labeled as
 * such per Phase 1 Pass 2 (Flow 3) so a reader doesn't go hunting for a
 * matching UI screen. Content is the user's verbatim note 1 from the
 * work-log intent. No cross-link: this section describes an in-person bank
 * visit, not a Ledger surface.
 */
export default function BankTransitionSection() {
  return (
    <section id="bank-transition" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Treasurer Transition — Bank Account</h2>
      <p className="mt-2 text-sm text-gray-500">
        This is a club/bank process, not something you do inside The Ledger — there is no
        matching screen in the app for these steps. When the treasurer role changes hands, the
        Chase account&rsquo;s authorized signers need to change with it.
      </p>

      <ul className="mt-4 space-y-3 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">Meeting minutes are required</span> before the bank
          will change signers on the account — bring a copy (or be prepared to reference the
          board minute) documenting the officer change.
        </li>
        <li>
          <span className="font-semibold">Two forms of ID</span> are required for each new
          signer at the branch. A credit card counts as a second form of ID.
        </li>
        <li>
          Make the <span className="font-semibold">treasurer the primary</span> signer on the
          account.
        </li>
        <li>
          <span className="font-semibold">Who needs to attend:</span> the new president, the new
          treasurer, and one of the two signers from the previous year.
        </li>
        <li>
          <span className="font-semibold">Budget about two hours</span> at the branch for the
          visit.
        </li>
      </ul>
    </section>
  );
}
