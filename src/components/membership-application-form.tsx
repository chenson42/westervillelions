"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
const IS_DEV = process.env.NODE_ENV === "development";

type MemberType = "new" | "former" | "transfer" | "family" | "student" | "leo" | "young_adult";

const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  new: "New Member",
  former: "Former Member",
  transfer: "Transfer Member",
  family: "Family Member",
  student: "Student Member",
  leo: "Current or Former Leo",
  young_adult: "Young Adult",
};

export function MembershipApplicationForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [memberType, setMemberType] = useState<MemberType>("new");
  const [captchaToken, setCaptchaToken] = useState<string | null>(IS_DEV ? "dev-bypass" : null);
  const [captchaError, setCaptchaError] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!captchaToken && !captchaError) {
      toast.error("Please complete the CAPTCHA verification.");
      return;
    }

    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const data = { ...Object.fromEntries(formData.entries()), captchaToken };

    try {
      const res = await fetch("/api/membership-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit application");
      }

      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit application");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 p-8 rounded-lg text-center">
        <div className="text-5xl mb-4">🦁</div>
        <h3 className="text-2xl font-bold text-green-800 mb-2">Application Received!</h3>
        <p className="text-green-700 mb-4">
          Thank you for applying to join the Westerville Lions Club. A club representative will
          review your application and be in touch with you soon.
        </p>
        <p className="text-sm text-green-600">
          In the meantime, you&apos;re welcome to attend one of our meetings as a guest.
        </p>
      </div>
    );
  }

  const showPreviousClub = memberType === "former" || memberType === "transfer";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Personal Information */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          Personal Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="firstName"
              name="firstName"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="middleInitial" className="block text-sm font-medium text-gray-700 mb-1">
              MI
            </label>
            <input
              type="text"
              id="middleInitial"
              name="middleInitial"
              maxLength={1}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="lastName"
              name="lastName"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div>
            <label htmlFor="suffix" className="block text-sm font-medium text-gray-700 mb-1">
              Suffix
            </label>
            <input
              type="text"
              id="suffix"
              name="suffix"
              placeholder="Jr., Sr., III..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
              Gender
            </label>
            <select
              id="gender"
              name="gender"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            >
              <option value="">Prefer not to say</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Non-binary">Non-binary</option>
            </select>
          </div>
          <div>
            <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700 mb-1">
              Date of Birth
            </label>
            <input
              type="date"
              id="dateOfBirth"
              name="dateOfBirth"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label htmlFor="occupation" className="block text-sm font-medium text-gray-700 mb-1">
              Occupation
            </label>
            <input
              type="text"
              id="occupation"
              name="occupation"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="spouseName" className="block text-sm font-medium text-gray-700 mb-1">
              Spouse&apos;s Name
            </label>
            <input
              type="text"
              id="spouseName"
              name="spouseName"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
        </div>
      </section>

      {/* Contact Information */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          Contact Information
        </h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
              Street Address
            </label>
            <input
              type="text"
              id="address"
              name="address"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2">
              <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                City
              </label>
              <input
                type="text"
                id="city"
                name="city"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
                State
              </label>
              <input
                type="text"
                id="state"
                name="state"
                maxLength={2}
                placeholder="OH"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="zip" className="block text-sm font-medium text-gray-700 mb-1">
                ZIP
              </label>
              <input
                type="text"
                id="zip"
                name="zip"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Membership Type */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          Membership Type
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(MEMBER_TYPE_LABELS) as MemberType[]).map((type) => (
            <label
              key={type}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition ${
                memberType === type
                  ? "border-lions-blue bg-lions-blue/5 text-lions-blue"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <input
                type="radio"
                name="memberType"
                value={type}
                checked={memberType === type}
                onChange={() => setMemberType(type)}
                className="accent-lions-blue"
              />
              <span className="text-sm font-medium">{MEMBER_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>

        {showPreviousClub && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <label htmlFor="previousMemberNumber" className="block text-sm font-medium text-gray-700 mb-1">
                Previous Member Number
              </label>
              <input
                type="text"
                id="previousMemberNumber"
                name="previousMemberNumber"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="previousClubName" className="block text-sm font-medium text-gray-700 mb-1">
                Previous Club Name
              </label>
              <input
                type="text"
                id="previousClubName"
                name="previousClubName"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="previousClubNumber" className="block text-sm font-medium text-gray-700 mb-1">
                Previous Club Number
              </label>
              <input
                type="text"
                id="previousClubNumber"
                name="previousClubNumber"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
              />
            </div>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="sponsorName" className="block text-sm font-medium text-gray-700 mb-1">
            Member Sponsor (if known)
          </label>
          <input
            type="text"
            id="sponsorName"
            name="sponsorName"
            className="w-full md:w-1/2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
          />
        </div>
      </section>

      {/* Softened per site-review batch 5 (2026-09-04): the LCI legal
          boilerplate below is required, unedited application language — it
          just shouldn't be the last, most prominent thing a visitor reads
          before submitting. A smaller-print Privacy Policy note now sits
          above it, and the boilerplate itself is styled as fine print
          rather than a highlighted callout box. */}
      <p className="text-xs text-gray-500">
        See our{" "}
        <Link href="/privacy" className="underline hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
          Privacy Policy
        </Link>{" "}
        for how we handle the information you provide here.
      </p>

      <p className="text-xs text-gray-500 italic border-t border-gray-200 pt-4">
        By submitting this application, I accept membership into Lions Clubs International and
        acknowledge that the standards are limited to persons of good moral character and
        reputation. I recognize the importance of rendering personal service to my community
        in cooperation with other civic-minded persons. I understand that membership is not
        valid until approved by the club&apos;s board of directors.
      </p>

      {!IS_DEV && (
        <Turnstile
          ref={turnstileRef}
          siteKey={SITE_KEY}
          onSuccess={(token) => setCaptchaToken(token)}
          onExpire={() => setCaptchaToken(null)}
          onError={() => setCaptchaError(true)}
          options={{ theme: "light" }}
        />
      )}

      <button
        type="submit"
        disabled={isSubmitting || (!captchaToken && !IS_DEV)}
        className="w-full bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Submitting..." : "Submit Application"}
      </button>
    </form>
  );
}
