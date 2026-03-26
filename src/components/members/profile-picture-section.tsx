"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ProfilePictureUploader } from "./profile-picture-uploader";

export interface ProfilePictureSectionProps {
  currentPhotoDataUri: string | null;
  memberName: string;
  /** When provided, calls admin API routes for this member id. */
  adminMemberId?: string;
}

export function ProfilePictureSection({
  currentPhotoDataUri,
  memberName,
  adminMemberId,
}: ProfilePictureSectionProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(currentPhotoDataUri);

  const saveUrl = adminMemberId
    ? `/api/admin/members/${adminMemberId}/profile-picture`
    : "/api/members/profile-picture";

  async function handleSave(dataUri: string) {
    const res = await fetch(saveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUri }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error((body as { error?: string }).error ?? "Failed to save photo");
      throw new Error("save failed");
    }
    setPhotoUri(dataUri);
    toast.success("Profile photo saved");
  }

  async function handleRemove() {
    const res = await fetch(saveUrl, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error((body as { error?: string }).error ?? "Failed to remove photo");
      throw new Error("remove failed");
    }
    setPhotoUri(null);
    toast.success("Profile photo removed");
  }

  return (
    <ProfilePictureUploader
      currentPhotoUrl={photoUri}
      memberName={memberName}
      onSave={handleSave}
      onRemove={handleRemove}
    />
  );
}
