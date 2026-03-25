import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { newsletterSubscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "zeffy";

  const subscribers = await db
    .select()
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.isActive, true))
    .orderBy(newsletterSubscriptions.subscribedAt);

  if (format === "zeffy") {
    const rows = subscribers.map((s) => ({
      "First Name": s.firstName ?? "",
      "Last Name": s.lastName ?? "",
      Email: s.email,
      "Language (EN or FR)": "EN",
      Address: "",
      City: "",
      Region: "",
      "Postal code": "",
      Country: "",
      Phone: "",
      Lists: "Lions Members",
      Note: "",
      "Subscription status": "subscribed",
      "Company name": "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Subscribers");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

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
