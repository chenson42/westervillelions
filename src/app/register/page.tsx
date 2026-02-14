"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (formData.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Registration failed");
      }

      const data = await response.json();

      toast.success(
        data.linkedMember
          ? "Account created and linked to your member profile!"
          : "Account created successfully!"
      );

      router.push("/signin");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An error occurred"
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div>
          <Link href="/" className="flex justify-center">
            <span className="text-6xl">🦁</span>
          </Link>
          <h1 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
            Create Your Account
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Join the Westerville Lions Club member portal
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="sr-only">
                Full name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={formData.name}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
                placeholder="Full name"
              />
            </div>

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
                value={formData.email}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
                placeholder="Email address"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use the same email as your member record if applicable
              </p>
            </div>

            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={formData.password}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
                placeholder="Password (min. 8 characters)"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={formData.confirmPassword}
                onChange={handleChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
                placeholder="Confirm password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full justify-center rounded-md bg-lions-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? "Creating account..." : "Create Account"}
            </button>
          </div>

          <div className="text-center text-sm">
            <span className="text-gray-600">Already have an account? </span>
            <Link
              href="/signin"
              className="font-medium text-lions-red hover:text-red-700"
            >
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
