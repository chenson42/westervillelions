import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const RELEASE_NOTES_DIR = join(process.cwd(), "docs", "release-notes");

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  // List available files
  if (!file) {
    if (!existsSync(RELEASE_NOTES_DIR)) {
      return NextResponse.json({ files: [] });
    }
    const files = readdirSync(RELEASE_NOTES_DIR)
      .filter((f) => f.endsWith(".md"))
      // Numeric-aware sort so v1.10 ranks above v1.9 (plain string sort puts v1.10 between v1.0 and v1.2).
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // newest first
    return NextResponse.json({ files });
  }

  // Serve a specific file — only allow simple filenames (no path traversal)
  if (!/^v[\d.]+\.md$/.test(file)) {
    return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  }

  const filePath = join(RELEASE_NOTES_DIR, file);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const content = readFileSync(filePath, "utf-8");
  return NextResponse.json({ content });
}
