import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import ReleaseNotesViewer from "@/components/admin/release-notes-viewer";

const RELEASE_NOTES_DIR = join(process.cwd(), "docs", "release-notes");

export default async function ReleaseNotesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  let files: string[] = [];
  let initialContent = "";
  let initialFile = "";

  if (existsSync(RELEASE_NOTES_DIR)) {
    files = readdirSync(RELEASE_NOTES_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    if (files.length > 0) {
      initialFile = files[0];
      initialContent = readFileSync(join(RELEASE_NOTES_DIR, initialFile), "utf-8");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Release Notes</h1>
        <p className="mt-2 text-gray-600">What&apos;s changed in each version</p>
      </div>

      <ReleaseNotesViewer
        files={files}
        initialFile={initialFile}
        initialContent={initialContent}
      />
    </div>
  );
}
