import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * GET /api/admin/campaigns
 * List all campaigns
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canManage = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const campaignList = await db
      .select()
      .from(campaigns)
      .orderBy(campaigns.displayOrder);

    return NextResponse.json(campaignList);
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/campaigns
 * Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission
    const canManage = await hasFeature(session.user.id, FEATURES.CAMPAIGNS_MANAGE);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = await request.json();

    // Validate required fields
    if (!data.title || !data.zeffyLink) {
      return NextResponse.json(
        { error: "Title and Zeffy link are required" },
        { status: 400 }
      );
    }

    // Create campaign
    const [newCampaign] = await db
      .insert(campaigns)
      .values({
        title: data.title,
        description: data.description || null,
        zeffyLink: data.zeffyLink,
        image: data.image || null,
        displayOrder: data.displayOrder || 0,
        isActive: data.isActive ?? true,
      })
      .returning();

    return NextResponse.json(newCampaign, { status: 201 });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}
