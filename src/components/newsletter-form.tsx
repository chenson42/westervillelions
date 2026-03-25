"use client";

import { useState } from "react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName }),
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStatus("error");
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
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
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
      </div>

      {status === "error" && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50 transition"
      >
        {status === "loading" ? "Subscribing…" : "Subscribe to Newsletter"}
      </button>

      <p className="text-xs text-gray-500">
        We respect your privacy. Unsubscribe at any time by contacting us.
      </p>
    </form>
  );
}
