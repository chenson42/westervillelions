"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

export default function ReleaseNotesViewer({
  files,
  initialFile,
  initialContent,
}: {
  files: string[];
  initialFile: string;
  initialContent: string;
}) {
  const [activeFile, setActiveFile] = useState(initialFile);
  const [content, setContent] = useState(initialContent);
  const [loading, setLoading] = useState(false);

  async function loadFile(file: string) {
    if (file === activeFile) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/release-notes?file=${file}`);
      const data = await res.json();
      setContent(data.content ?? "");
      setActiveFile(file);
    } finally {
      setLoading(false);
    }
  }

  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
        No release notes found in <code>docs/release-notes/</code>.
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Version picker */}
      {files.length > 1 && (
        <div className="w-40 shrink-0">
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Versions
            </div>
            <nav className="p-1">
              {files.map((file) => {
                const label = file.replace(".md", "");
                return (
                  <button
                    key={file}
                    onClick={() => loadFile(file)}
                    className={`w-full rounded px-3 py-1.5 text-left text-sm font-medium transition-colors ${
                      file === activeFile
                        ? "bg-lions-blue text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Markdown content */}
      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            Loading...
          </div>
        ) : (
          <div className="release-notes-body text-sm text-gray-700 leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:text-gray-800 [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_li]:mb-0.5 [&_a]:text-lions-blue [&_a]:underline [&_code]:bg-gray-100 [&_code]:text-gray-800 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre]:bg-gray-100 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_hr]:my-6 [&_hr]:border-gray-200 [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-gray-500 [&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-2 [&_blockquote]:border-l-4 [&_blockquote]:border-lions-blue [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-3">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
