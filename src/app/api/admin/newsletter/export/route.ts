import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { newsletterSubscriptions } from "@/lib/db/schema";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

const ZEFFY_COLUMNS = [
  { header: "First Name", key: "firstName" },
  { header: "Last Name", key: "lastName" },
  { header: "Email", key: "email" },
  { header: "Language (EN or FR)", key: "language" },
  { header: "Address", key: "address" },
  { header: "City", key: "city" },
  { header: "Region", key: "region" },
  { header: "Postal code", key: "postalCode" },
  { header: "Country", key: "country" },
  { header: "Phone", key: "phone" },
  { header: "Lists", key: "lists" },
  { header: "Note", key: "note" },
  { header: "Subscription status", key: "subscriptionStatus" },
  { header: "Company name", key: "companyName" },
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // FEATURES.SUBSCRIPTIONS_VIEW (the same key that now gates the
  // /admin/subscriptions page — see FEATURES.SUBSCRIPTIONS_VIEW's doc
  // comment) OR the generic REPORTS_EXPORT, matching the OR-pattern
  // src/app/api/admin/dues/export/route.ts and .../ledger/export/route.ts
  // already use (resource-specific permission OR the cross-cutting export
  // grant). Previously this route checked REPORTS_EXPORT alone — a
  // standalone "wrong key" gap found while fixing /admin/subscriptions:
  // not live-exploitable today (only admin/board_member hold
  // reports.export, and both already hold subscriptions.view), but a future
  // role granted reports.export for an unrelated report would have silently
  // been able to download the full newsletter-subscriber PII list via this
  // endpoint with no relationship to the page's own gate.
  const canExport = await hasAnyFeature(session.user.id, [
    FEATURES.SUBSCRIPTIONS_VIEW,
    FEATURES.REPORTS_EXPORT,
  ]);
  if (!canExport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "zeffy";

  const subscribers = await db
    .select()
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.isActive, true))
    .orderBy(newsletterSubscriptions.subscribedAt);

  if (format === "zeffy") {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Subscribers");
    sheet.columns = ZEFFY_COLUMNS;
    for (const s of subscribers) {
      sheet.addRow({
        firstName: s.firstName ?? "",
        lastName: s.lastName ?? "",
        email: s.email,
        language: "EN",
        address: "",
        city: "",
        region: "",
        postalCode: "",
        country: "",
        phone: "",
        lists: "Newsletter Subscribed",
        note: "",
        subscriptionStatus: "subscribed",
        companyName: "",
      });
    }
    const buf = await wb.xlsx.writeBuffer();

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="zeffy-newsletter-subscribers.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
