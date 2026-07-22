/**
 * Bank Transition — Chase Account Ownership (guide §1)
 *
 * Club/bank operational process, not app behavior — explicitly labeled as
 * such per Phase 1 Pass 2 (Flow 3) so a reader doesn't go hunting for a
 * matching UI screen. No cross-link: this section describes an in-person bank
 * visit, not a Ledger surface.
 *
 * Content expanded 2026-07-22 from the user's fuller transition notes: adds
 * the July-1 timing, the Account Rep role (assignment + account-address
 * change), debit-card destroy/reissue, and the fuller attendee list. The
 * prior version's two-forms-of-ID and ~two-hour points are retained.
 */
export default function BankTransitionSection() {
  return (
    <section id="bank-transition" className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-xl font-bold text-gray-900">Treasurer Transition — Bank Account</h2>
      <p className="mt-2 text-sm text-gray-500">
        This is a club/bank process, not something you do inside The Ledger — there is no
        matching screen in the app for these steps. When the treasurer role changes hands, the
        Chase account&rsquo;s access, signers, and cards need to change with it.
      </p>

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-700">When</h3>
      <p className="mt-2 text-sm text-gray-700">
        As soon as is practical after July 1 (the start of the new officer year), schedule an
        in-person visit to the branch to make these changes. Plan for about{" "}
        <span className="font-semibold">two hours</span> at the branch.
      </p>

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-700">
        Who should attend
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>The prior-year Treasurer</li>
        <li>The account&rsquo;s current Account Rep, if that is not the prior-year Treasurer</li>
        <li>The incoming Treasurer</li>
        <li>The incoming President</li>
        <li>The incoming Secretary (probably optional)</li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-700">
        What to bring
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">Minutes of the meeting electing the new officers</span>
          {" "}— the bank requires this before it will change access on the account.
        </li>
        <li>
          <span className="font-semibold">Two forms of ID</span> for each new signer. A credit
          card counts as a second form of ID.
        </li>
      </ul>

      <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-700">
        Tasks at the meeting
      </h3>
      <ul className="mt-2 space-y-2 text-sm text-gray-700 list-disc pl-5">
        <li>
          <span className="font-semibold">Assign a new Account Rep</span> — this should be the
          incoming Treasurer.
        </li>
        <li>
          <span className="font-semibold">Make the treasurer the primary signer</span> on the
          account.
        </li>
        <li>
          <span className="font-semibold">Change the account&rsquo;s mailing address</span> to the
          new Account Rep (the Treasurer).
        </li>
        <li>
          <span className="font-semibold">Destroy the previous debit cards.</span>
        </li>
        <li>
          <span className="font-semibold">Issue new debit cards</span> — one for each account —
          to the incoming Treasurer and the incoming President.
        </li>
      </ul>
    </section>
  );
}
