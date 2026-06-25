/**
 * StandingReminders — Server Component (no props, no client state)
 *
 * Static advisory copy drawn from the Lions Financial Transparency Policy.
 * Renders identically for all users. No data dependency.
 */

interface ReminderItem {
  icon: string;
  heading: string;
  body: string;
}

const REMINDERS: ReminderItem[] = [
  {
    icon: "🎟️",
    heading: "Raffle / lottery proceeds",
    body: "At least 50% of net raffle proceeds must be donated to a charitable cause. Keep records of ticket sales, expenses, and the charitable distribution made from each raffle.",
  },
  {
    icon: "🗳️",
    heading: "No political endorsements",
    body: "As a 501(c)(4) / 501(c)(3) organization, the club may not endorse candidates, make political donations, or use club funds for partisan activity. Any ambiguous activity should be cleared with the board before proceeding.",
  },
  {
    icon: "🧾",
    heading: "Sales tax on taxable products",
    body: "Fundraising sales of taxable products (merchandise, food, beverages) may be subject to Ohio sales tax. Consult the treasurer before pricing any sale to ensure proper tax collection and remittance.",
  },
  {
    icon: "🎰",
    heading: "Gaming / games of chance",
    body: "Bingo, pull-tabs, and other games of chance require an Ohio gaming license. Do not conduct any game of chance without confirming current licensure and compliance with Ohio Revised Code Chapter 2915.",
  },
  {
    icon: "💵",
    heading: "No informal employment (gift cards / waived dues)",
    body: "Paying volunteers with gift cards, waiving their club dues, or providing other taxable compensation may create employment tax obligations. All such payments should be reviewed by the treasurer before approval.",
  },
  {
    icon: "📱",
    heading: "Social media monitoring",
    body: "Club accounts and members acting in an official capacity are subject to the same compliance rules as in-person communications. Ensure posts do not imply political endorsements, promise guarantees, or make claims that could expose the club to liability.",
  },
  {
    icon: "📂",
    heading: "7-year record retention",
    body: "All financial records — bank statements, receipts, contracts, tax filings, grant records — must be retained for at least 7 years. Digital copies are acceptable if backed up securely.",
  },
];

export default function StandingReminders() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="mb-4">
        <p className="uppercase tracking-widest text-xs text-lions-gold font-semibold mb-1">
          Standing Compliance Reminders
        </p>
        <h2 className="text-lg font-semibold text-gray-900">Ongoing Obligations</h2>
        <p className="mt-1 text-sm text-gray-500">
          These rules apply year-round regardless of the filing calendar above. Review with new
          board members annually.
        </p>
      </div>

      <ul className="space-y-4" role="list">
        {REMINDERS.map((r) => (
          <li
            key={r.heading}
            className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3"
          >
            <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">
              {r.icon}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{r.heading}</p>
              <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{r.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
