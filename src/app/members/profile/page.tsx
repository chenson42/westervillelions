import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-red text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">My Profile</h1>
          <p className="text-xl">Update your information</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <a
            href="/members"
            className="text-lions-red hover:underline"
          >
            ← Back to Member Portal
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 max-w-2xl">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Profile Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <p className="text-lg text-gray-900">{session.user.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <p className="text-lg text-gray-900">{session.user.email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <p className="text-lg text-gray-900 capitalize">{session.user.role}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <p className="text-gray-600 mb-4">
              Profile editing features will be available in the full version.
            </p>
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="bg-gray-200 text-gray-900 px-6 py-2 rounded-lg hover:bg-gray-300 transition"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
