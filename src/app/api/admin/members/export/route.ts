import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

type ExportFormat = "zeffy";

// Zeffy import columns. Order is preserved in the rendered sheet.
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

async function fetchMembers() {
  return db
    .select()
    .from(members)
    .where(eq(members.isActive, true))
    .orderBy(members.lastName, members.firstName);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canExport = await hasFeature(session.user.id, FEATURES.REPORTS_EXPORT);
  if (!canExport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") ?? "zeffy") as ExportFormat;

  const memberList = await fetchMembers();

  if (format === "zeffy") {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Members");
    sheet.columns = ZEFFY_COLUMNS;
    for (const m of memberList) {
      sheet.addRow({
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email ?? "",
        language: "EN",
        address: m.address ?? "",
        city: m.city ?? "",
        region: m.state ?? "",
        postalCode: m.zip ?? "",
        country: "USA",
        phone: m.phone ?? "",
        lists: "Lions Members",
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
        "Content-Disposition": `attachment; filename="zeffy-members-export.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
