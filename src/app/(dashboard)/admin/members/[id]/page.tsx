import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import MemberForm from "@/components/admin/member-form";
import Link from "next/link";
import type { MemberFormData } from "@/components/admin/member-form";
import { ProfilePictureSection } from "@/components/members/profile-picture-section";

/**
 * Edit Member Page
 *
 * Form to edit an existing club member.
 */
export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });

  if (!member) {
    notFound();
  }

  // Convert to form data format
  const formData: MemberFormData = {
    memberNumber: member.memberNumber,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    phone: member.phone,
    address: member.address,
    city: member.city,
    state: member.state,
    zip: member.zip,
    branch: member.branch,
    dateOfBirth: member.dateOfBirth,
    joinDate: member.joinDate ? member.joinDate.toISOString().split("T")[0] : null,
    membershipEndedDate: member.membershipEndedDate ?? null,
    membershipStatus: member.membershipStatus as MemberFormData["membershipStatus"],
    membershipType: member.membershipType as MemberFormData["membershipType"],
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/members" className="hover:text-gray-900">
            Members
          </Link>
          <span>/</span>
          <span className="text-gray-900">
            {member.firstName} {member.lastName}
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Edit Member</h1>
      </div>

      {/* Profile Photo */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile Photo</h2>
        <ProfilePictureSection
          currentPhotoDataUri={member.profilePicture}
          memberName={`${member.firstName} ${member.lastName}`}
          adminMemberId={id}
        />
      </div>

      {/* Form */}
      <MemberForm member={formData} memberId={id} />
    </div>
  );
}
