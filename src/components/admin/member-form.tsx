"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type MembershipStatus = "prospective" | "active" | "ended";

// Mirrors MembershipType / MEMBERSHIP_TYPES in src/lib/members.ts. Not imported directly:
// members.ts pulls in @/lib/db (for provisionUserForMember) at module scope, and this is a
// "use client" component — importing from members.ts would drag the Postgres client into the
// browser bundle and break the build ("Can't resolve 'tls'"). Same reason MembershipStatus
// above is a local duplicate rather than an import. Keep these two lists in sync by hand; both
// are covered by isValidMembershipType()'s exhaustive test in src/lib/members.test.ts.
export type MembershipType =
  | "active"
  | "member_at_large"
  | "honorary"
  | "privileged"
  | "life_member"
  | "associate_member"
  | "affiliate_member";

export const TYPE_OPTIONS: { value: MembershipType; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "member_at_large", label: "Member at Large" },
  { value: "honorary", label: "Honorary" },
  { value: "privileged", label: "Privileged" },
  { value: "life_member", label: "Life Member" },
  { value: "associate_member", label: "Associate Member" },
  { value: "affiliate_member", label: "Affiliate Member" },
];

export interface MemberFormData {
  memberNumber?: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  branch?: string | null;
  dateOfBirth?: string | null;
  joinDate?: string | null;
  membershipEndedDate?: string | null;
  membershipStatus: MembershipStatus;
  membershipType: MembershipType;
}

const STATUS_OPTIONS: { value: MembershipStatus; label: string }[] = [
  { value: "prospective", label: "Prospective" },
  { value: "active", label: "Active" },
  { value: "ended", label: "Ended" },
];

const MONTHS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

function parseDateOfBirth(dob: string | null | undefined) {
  if (!dob) return { month: "", day: "", year: "" };
  // Format: YYYY-MM-DD or --MM-DD (year omitted)
  const noYear = dob.startsWith("--");
  const parts = noYear ? dob.slice(2).split("-") : dob.split("-");
  if (noYear) return { month: parts[0] ?? "", day: parts[1] ?? "", year: "" };
  return { month: parts[1] ?? "", day: parts[2] ?? "", year: parts[0] ?? "" };
}

function composeDateOfBirth(month: string, day: string, year: string): string | null {
  if (!month || !day) return null;
  if (year) return `${year.padStart(4, "0")}-${month}-${day}`;
  return `--${month}-${day}`;
}

export default function MemberForm({
  member,
  memberId,
}: {
  member?: MemberFormData;
  memberId?: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formData, setFormData] = useState<MemberFormData>(
    member || {
      firstName: "",
      lastName: "",
      email: "",
      membershipStatus: "active",
      membershipType: "active",
    }
  );

  const [birthMonth, setBirthMonth] = useState(() => parseDateOfBirth(member?.dateOfBirth).month);
  const [birthDay, setBirthDay] = useState(() => parseDateOfBirth(member?.dateOfBirth).day);
  const [birthYear, setBirthYear] = useState(() => parseDateOfBirth(member?.dateOfBirth).year);

  function updateBirthday(month: string, day: string, year: string) {
    setFormData((prev) => ({
      ...prev,
      dateOfBirth: composeDateOfBirth(month, day, year),
    }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setIsSubmitting(true);

    try {
      const url = memberId
        ? `/api/admin/members/${memberId}`
        : "/api/admin/members";
      const method = memberId ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const body = await response.json();
        const message: string = body.error || "Failed to save member";

        // Surface email-specific errors inline rather than just as a toast
        if (
          response.status === 409 ||
          message.toLowerCase().includes("email")
        ) {
          setEmailError(message);
          setIsSubmitting(false);
          return;
        }

        throw new Error(message);
      }

      toast.success(memberId ? "Member updated successfully" : "Member created successfully");
      router.push("/admin/members");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : type === "number"
          ? value === ""
            ? null
            : parseInt(value, 10)
          : value || null,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Information */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Basic Information
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-gray-700"
            >
              First Name *
            </label>
            <input
              type="text"
              id="firstName"
              name="firstName"
              required
              value={formData.firstName}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="block text-sm font-medium text-gray-700"
            >
              Last Name *
            </label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              required
              value={formData.lastName}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={formData.email || ""}
              onChange={(e) => {
                setEmailError(null);
                handleChange(e);
              }}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-lions-blue ${
                emailError
                  ? "border-amber-500 focus:border-amber-500"
                  : "border-gray-300 focus:border-lions-blue"
              }`}
            />
            {emailError && (
              <p className="mt-1 text-sm text-amber-700">{emailError}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-gray-700"
            >
              Phone
            </label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="memberNumber"
              className="block text-sm font-medium text-gray-700"
            >
              Member Number
            </label>
            <input
              type="number"
              id="memberNumber"
              name="memberNumber"
              value={formData.memberNumber || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="joinDate"
              className="block text-sm font-medium text-gray-700"
            >
              Join Date
            </label>
            <input
              type="date"
              id="joinDate"
              name="joinDate"
              value={formData.joinDate || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="membershipEndedDate"
              className={`block text-sm font-medium ${
                formData.membershipStatus === "ended" ? "text-gray-700" : "text-gray-400"
              }`}
            >
              Membership Ended
            </label>
            <input
              type="date"
              id="membershipEndedDate"
              name="membershipEndedDate"
              value={formData.membershipEndedDate || ""}
              onChange={handleChange}
              disabled={formData.membershipStatus !== "ended"}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:bg-gray-100 disabled:text-gray-400"
            />
            {formData.membershipStatus !== "ended" && (
              <p className="mt-1 text-xs text-gray-500">
                Only applies when status is Ended.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Address</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="address"
              className="block text-sm font-medium text-gray-700"
            >
              Street Address
            </label>
            <input
              type="text"
              id="address"
              name="address"
              value={formData.address || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="city"
              className="block text-sm font-medium text-gray-700"
            >
              City
            </label>
            <input
              type="text"
              id="city"
              name="city"
              value={formData.city || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="state"
              className="block text-sm font-medium text-gray-700"
            >
              State
            </label>
            <input
              type="text"
              id="state"
              name="state"
              value={formData.state || ""}
              onChange={handleChange}
              maxLength={2}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label
              htmlFor="zip"
              className="block text-sm font-medium text-gray-700"
            >
              ZIP Code
            </label>
            <input
              type="text"
              id="zip"
              name="zip"
              value={formData.zip || ""}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>
        </div>
      </div>

      {/* Club Information */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Club Information
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="branch"
              className="block text-sm font-medium text-gray-700"
            >
              Branch
            </label>
            <input
              type="text"
              id="branch"
              name="branch"
              value={formData.branch || ""}
              onChange={handleChange}
              placeholder="e.g., Main, Somali Branch"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Birthday
            </label>
            <div className="mt-1 flex gap-2">
              <select
                value={birthMonth}
                onChange={(e) => {
                  setBirthMonth(e.target.value);
                  updateBirthday(e.target.value, birthDay, birthYear);
                }}
                className="rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Month</option>
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select
                value={birthDay}
                onChange={(e) => {
                  setBirthDay(e.target.value);
                  updateBirthday(birthMonth, e.target.value, birthYear);
                }}
                className="rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              >
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => {
                  const d = String(i + 1).padStart(2, "0");
                  return <option key={d} value={d}>{i + 1}</option>;
                })}
              </select>
              <input
                type="number"
                value={birthYear}
                onChange={(e) => {
                  setBirthYear(e.target.value);
                  updateBirthday(birthMonth, birthDay, e.target.value);
                }}
                placeholder="Year"
                min={1900}
                max={new Date().getFullYear()}
                className="w-24 rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">Year is optional</p>
          </div>

          <div>
            <label
              htmlFor="membershipStatus"
              className="block text-sm font-medium text-gray-700"
            >
              Membership Status *
            </label>
            <select
              id="membershipStatus"
              name="membershipStatus"
              required
              value={formData.membershipStatus}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Prospective members receive club emails but aren&apos;t counted as active
              members or given portal access until inducted.
            </p>
          </div>

          <div>
            <label
              htmlFor="membershipType"
              className="block text-sm font-medium text-gray-700"
            >
              Lions International Membership Type *
            </label>
            <select
              id="membershipType"
              name="membershipType"
              required
              value={formData.membershipType}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              The member&apos;s LCI membership category (e.g. Life, Honorary, Associate) —
              separate from Membership Status above, which tracks whether they&apos;re
              currently in good standing with the club.
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? "Saving..." : memberId ? "Update Member" : "Create Member"}
        </button>
      </div>
    </form>
  );
}
