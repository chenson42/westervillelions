import type { AttachedFileSummary } from "@/lib/club-files-queries";

/**
 * Modest "Downloads" section shared by the public (/events/[id]) and member
 * (/members/events/[id], which redirects to the same page) event detail
 * pages — docs/work-log/2026-09-04-club-documents.md, Phase 3 Component
 * Plan. Server-renderable, no client JS needed: each row is a plain link to
 * the unified download route.
 */
export function AttachedFilesList({ files }: { files: AttachedFileSummary[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mt-8 mb-10">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Downloads</h2>
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id}>
            <a
              href={`/api/club-files/${file.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 bg-white rounded-2xl shadow-sm overflow-hidden p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{file.name}</p>
                {file.description && <p className="text-sm text-gray-500">{file.description}</p>}
              </div>
              <span className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-lions-blue">
                Download
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
                  />
                </svg>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
