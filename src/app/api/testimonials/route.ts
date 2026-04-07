import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { testimonials } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

/**
 * GET /api/testimonials
 * Public endpoint — returns all active testimonials ordered by sort_order ASC
 */
export async function GET() {
  try {
    const activeTestimonials = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.isActive, true))
      .orderBy(asc(testimonials.sortOrder), asc(testimonials.createdAt));

    return NextResponse.json({ testimonials: activeTestimonials });
  } catch (error) {
    console.error("Error fetching testimonials:", error);
    return NextResponse.json(
      { error: "Failed to fetch testimonials" },
      { status: 500 }
    );
  }
}
