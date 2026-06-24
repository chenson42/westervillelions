import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * GET /api/admin/zeffy-meta?url=...
 * Fetches the og:image and og:description from a Zeffy campaign page.
 *
 * NOTE: Zeffy's Cloudflare now returns 403 to server-side fetches, so this
 * currently returns nulls in practice; kept for the admin campaign form's
 * best-effort prefill. See docs/reviews/2026-06-24-security.md.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Strict allowlist on the parsed hostname — a substring check like
  // url.includes("zeffy.com") is bypassable (e.g. https://evil.com/?x=zeffy.com,
  // https://zeffy.com.evil.com) and would let this endpoint fetch arbitrary URLs (SSRF).
  let target: URL;
  try {
    target = new URL(request.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || (host !== "zeffy.com" && host !== "www.zeffy.com")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WestervilleLions/1.0)" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return NextResponse.json({ image: null, description: null });

    const html = await res.text();

    const imageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/);

    const descMatch =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/);

    return NextResponse.json({
      image: imageMatch?.[1] ?? null,
      description: descMatch?.[1] ?? null,
    });
  } catch {
    return NextResponse.json({ image: null, description: null });
  }
}
