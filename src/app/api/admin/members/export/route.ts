import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";

type ExportFormat = "zeffy";

interface ZeffyRow {
  "First Name": string;
  "Last Name": string;
  Email: string;
  "Language (EN or FR)": string;
  Address: string;
  City: string;
  Region: string;
  "Postal code": string;
  Country: string;
  Phone: string;
  Lists: string;
  Note: string;
  "Subscription status": string;
  "Company name": string;
}

function toZeffyRows(memberList: Awaited<ReturnType<typeof fetchMembers>>): ZeffyRow[] {
  return memberList.map((m) => ({
    "First Name": m.firstName,
    "Last Name": m.lastName,
    Email: m.email ?? "",
    "Language (EN or FR)": "EN",
    Address: m.address ?? "",
    City: m.city ?? "",
    Region: m.state ?? "",
    "Postal code": m.zip ?? "",
    Country: "USA",
    Phone: m.phone ?? "",
    Lists: "Lions Members",
    Note: "",
    "Subscription status": "subscribed",
    "Company name": "",
  }));
}

async function fetchMembers() {
  return db
    .select()
    .from(members)
    .where(eq(members.isActive, true))
    .orderBy(members.lastName, members.firstName);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") ?? "zeffy") as ExportFormat;

  const memberList = await fetchMembers();

  if (format === "zeffy") {
    const rows = toZeffyRows(memberList);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Members");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

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
