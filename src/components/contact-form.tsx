"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
const IS_DEV = process.env.NODE_ENV === "development";

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
    const data = {
      name: formData.get("name"),
      email: formData.get("email"),
      message: formData.get("message"),
      captchaToken,
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send message");
      }

      setSubmitted(true);
      toast.success("Message sent! We'll be in touch soon.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
      turnstileRef.current?.reset();
      setCaptchaToken(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 p-8 rounded-lg text-center">
        <h3 className="text-2xl font-bold text-green-800 mb-2">Message Sent!</h3>
        <p className="text-green-700">
          Thank you for reaching out. We&apos;ll get back to you soon.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 p-8 rounded-lg">
      <h3 className="text-2xl font-bold mb-6 text-gray-900">Send Us a Message</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            required
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            required
          />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={6}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent"
            required
          />
        </div>
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
          disabled={isSubmitting || !captchaToken}
          className="w-full bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Sending..." : "Send Message"}
        </button>
        <p className="text-xs text-gray-500">
          See our{" "}
          <Link href="/privacy" className="underline hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
            Privacy Policy
          </Link>{" "}
          for how we handle your information.
        </p>
      </form>
    </div>
  );
}
