import MemberForm from "@/components/admin/member-form";
import Link from "next/link";

/**
 * New Member Page
 *
 * Form to create a new club member.
 */
export default function NewMemberPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/members" className="hover:text-gray-900">
            Members
          </Link>
          <span>/</span>
          <span className="text-gray-900">New Member</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Add New Member</h1>
      </div>

      {/* Form */}
      <MemberForm />
    </div>
  );
}
