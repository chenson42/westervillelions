import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * GET /api/admin/testimonials
 * List all testimonials (active + inactive) ordered by sort_order ASC
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allTestimonials = await db
      .select()
      .from(testimonials)
      .orderBy(asc(testimonials.sortOrder), asc(testimonials.createdAt));

    return NextResponse.json({ testimonials: allTestimonials });
  } catch (error) {
    console.error("Error fetching testimonials:", error);
    return NextResponse.json(
      { error: "Failed to fetch testimonials" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/testimonials
 * Create a new testimonial
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    if (!data.quote) {
      return NextResponse.json({ error: "Quote is required" }, { status: 400 });
    }
    if (!data.authorName) {
      return NextResponse.json({ error: "Author name is required" }, { status: 400 });
    }

    const [newTestimonial] = await db
      .insert(testimonials)
      .values({
        quote: data.quote,
        authorName: data.authorName,
        authorTitle: data.authorTitle || null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    return NextResponse.json(newTestimonial, { status: 201 });
  } catch (error) {
    console.error("Error creating testimonial:", error);
    return NextResponse.json(
      { error: "Failed to create testimonial" },
      { status: 500 }
    );
  }
}
