import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import MemberForm from "@/components/admin/member-form";
import Link from "next/link";
import type { MemberFormData } from "@/components/admin/member-form";

/**
 * Edit Member Page
 *
 * Form to edit an existing club member.
 */
export default async function EditMemberPage({
  params,
}: {
  params: { id: string };
}) {
  const member = await db.query.members.findFirst({
    where: eq(members.id, params.id),
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
    boardPosition: member.boardPosition,
    joinDate: member.joinDate ? member.joinDate.toISOString().split("T")[0] : null,
    isActive: member.isActive,
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

      {/* Form */}
      <MemberForm member={formData} memberId={params.id} />
    </div>
  );
}
