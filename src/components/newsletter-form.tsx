"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
const IS_DEV = process.env.NODE_ENV === "development";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(IS_DEV ? "dev-bypass" : null);
  const [captchaError, setCaptchaError] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!captchaToken && !captchaError) {
      setErrorMsg("Please complete the CAPTCHA verification.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName, captchaToken }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        turnstileRef.current?.reset();
        setCaptchaToken(null);
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStatus("error");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg bg-green-50 border border-green-200 p-6 text-center">
        <div className="text-3xl mb-2">✓</div>
        <p className="font-semibold text-green-800">You&apos;re subscribed!</p>
        <p className="text-green-700 text-sm mt-1">
          Thanks for signing up. We&apos;ll keep you in the loop on events and news from the Westerville Lions Club.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="nl-firstname" className="block text-sm font-medium text-gray-700 mb-1">
            First name
          </label>
          <input
            id="nl-firstname"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jane"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
        <div>
          <label htmlFor="nl-lastname" className="block text-sm font-medium text-gray-700 mb-1">
            Last name
          </label>
          <input
            id="nl-lastname"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Smith"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          />
        </div>
      </div>

      <div>
        <label htmlFor="nl-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email address <span className="text-red-500">*</span>
        </label>
        <input
          id="nl-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
      </div>

      {status === "error" && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

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
        disabled={status === "loading" || (!captchaToken && !IS_DEV)}
        className="w-full rounded-md bg-lions-blue px-4 py-3 text-base font-semibold text-white hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50 transition"
      >
        {status === "loading" ? "Subscribing…" : "Subscribe to Newsletter"}
      </button>

      <p className="text-xs text-gray-500">
        We respect your privacy. Unsubscribe at any time by contacting{" "}
        <a href="mailto:info@westervillelions.org" className="underline hover:text-gray-700">
          info@westervillelions.org
        </a>
        . See our{" "}
        <Link href="/privacy" className="underline hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
          Privacy Policy
        </Link>{" "}
        for how we handle your information.
      </p>
    </form>
  );
}
