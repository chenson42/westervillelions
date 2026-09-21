"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  userId: string;
  userName: string;
  hasExistingPassword: boolean;
}

/**
 * Admin-initiated, in-band password reset — see
 * docs/work-log/2026-09-18-admin-account-reset.md Phase 3 "Component Plan".
 *
 * Deliberately its own component, not a mode on SuspendUserButton: the
 * success state here is a persistent inline reveal panel carrying a
 * one-time secret, never a toast (a sonner toast auto-dismisses).
 */
export function ResetPasswordButton({ userId, userName, hasExistingPassword }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't reset the password. Try again.");
        return;
      }
      setRevealedPassword(data.password);
    } catch {
      toast.error("Couldn't reset the password. Try again.");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedPassword) return;
    try {
      await navigator.clipboard.writeText(revealedPassword);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the password and copy it manually.");
    }
  };

  const handleDone = () => {
    setRevealedPassword(null);
    router.refresh();
  };

  if (revealedPassword) {
    return (
      <div className="rounded-lg border border-lions-blue/20 bg-lions-blue/5 p-4">
        <h3 className="text-sm font-semibold text-gray-900">New password for {userName}</h3>
        <input
          readOnly
          value={revealedPassword}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 font-mono text-base text-gray-900 tracking-wider"
        />
        <p className="mt-2 text-sm text-gray-600">
          Copy this and share it with {userName} yourself — by phone or in person. It
          won&apos;t be shown again, and it hasn&apos;t been emailed to anyone.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-lions-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Copy password
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="rounded-lg border-2 border-lions-blue px-6 py-3 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const label = hasExistingPassword ? "Reset Password" : "Set Password";
  const title = hasExistingPassword
    ? `Reset password for ${userName}?`
    : `Set a password for ${userName}?`;
  const description = hasExistingPassword
    ? `This immediately replaces ${userName}'s password with a new, randomly generated one. Their roles, RSVPs, and everything they've authored in the club's records are unaffected. You'll need to share the new password with ${userName} yourself — by phone or in person. It will not be emailed.`
    : `${userName} currently signs in with Google and has no password on file. Setting one adds a new way to sign in — it will not fix a Google sign-in problem, and Google sign-in will keep working exactly as it does today. You'll need to share the new password with ${userName} yourself — by phone or in person. It will not be emailed.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={loading}
        className={
          hasExistingPassword
            ? "rounded-lg bg-red-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            : "rounded-lg bg-lions-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-lions-blue-dark disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
        }
      >
        {label}
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={label}
        destructive={hasExistingPassword}
        onConfirm={handleConfirm}
      />
    </>
  );
}
