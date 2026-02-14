import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

/**
 * Access Pending Page
 *
 * Shown to authenticated users who don't have permissions to access a requested resource.
 */
export default async function AccessPendingPage() {
  const session = await auth();

  // If not authenticated, redirect to sign-in
  if (!session?.user) {
    redirect("/signin");
  }

  const hasAnyRole = session.user.roles && session.user.roles.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <svg
              className="h-10 w-10 text-yellow-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
            Access Pending
          </h1>

          {hasAnyRole ? (
            <>
              <p className="mt-4 text-gray-600">
                Your account doesn&apos;t have permission to access this page.
              </p>
              <p className="mt-2 text-sm text-gray-500">
                Current role: <span className="font-medium">{session.user.roles?.[0]}</span>
              </p>
              <p className="mt-4 text-gray-600">
                If you believe you should have access, please contact an administrator.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-gray-600">
                Your account is being set up by an administrator.
              </p>
              <p className="mt-2 text-sm text-gray-500">
                You&apos;ll receive access once your account has been activated.
              </p>
            </>
          )}
        </div>

        <div className="mt-8 space-y-3">
          <Link
            href="/"
            className="block w-full rounded-md bg-lions-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
          >
            Return to Home
          </Link>

          <Link
            href="/contact"
            className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
          >
            Contact Support
          </Link>
        </div>

        <div className="mt-6 text-xs text-gray-500">
          Signed in as: {session.user.email}
        </div>
      </div>
    </div>
  );
}
