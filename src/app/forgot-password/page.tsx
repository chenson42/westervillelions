"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error("Failed to send reset email");
      }

      setIsSuccess(true);
      toast.success("Password reset email sent");
    } catch (error) {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md space-y-8 text-center">
          <div>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg
                className="h-10 w-10 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>

            <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
              Check Your Email
            </h1>

            <p className="mt-4 text-gray-600">
              We&apos;ve sent a password reset link to <strong>{email}</strong>
            </p>

            <p className="mt-2 text-sm text-gray-500">
              The link will expire in 24 hours.
            </p>
          </div>

          <Link
            href="/signin"
            className="block w-full rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div>
          <Link href="/" className="flex justify-center">
            <span className="text-6xl">🦁</span>
          </Link>
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Reset Your Password
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email address and we&apos;ll send you a link to reset your
            password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              placeholder="Email address"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full justify-center rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? "Sending..." : "Send Reset Link"}
            </button>
          </div>

          <div className="text-center">
            <Link
              href="/signin"
              className="text-sm font-medium text-lions-blue hover:text-lions-blue-dark"
            >
              Back to Sign In
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
