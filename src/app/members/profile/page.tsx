import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ProfileForm } from "@/components/members/profile-form";
import { ProfilePictureSection } from "@/components/members/profile-picture-section";
import { SignOutButton } from "@/components/layout/signout-button";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const member = session.user.id
    ? await db.query.members.findFirst({
        where: eq(members.userId, session.user.id),
      })
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">My Profile</h1>
          <p className="text-xl">Update your contact information</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <a href="/members" className="text-lions-blue hover:underline">
            ← Back to Member Portal
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 max-w-2xl">
          {/* Account info (read-only) */}
          <div className="mb-6 pb-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Account</h2>
            <div className="space-y-1 text-sm text-gray-600">
              <p><span className="font-medium">Sign-in email:</span> {session.user.email}</p>
              <p><span className="font-medium">Role:</span> <span className="capitalize">{session.user.role}</span></p>
            </div>
          </div>

          {member ? (
            <>
              <div className="mb-6 pb-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Profile Photo</h2>
                <ProfilePictureSection
                  currentPhotoDataUri={member.profilePicture}
                  memberName={`${member.firstName} ${member.lastName}`}
                />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Member Information</h2>
              <ProfileForm member={member} />
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-2">No member record is linked to your account.</p>
              <p className="text-sm text-gray-500">
                Contact an admin to link your account to a member record.
              </p>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
