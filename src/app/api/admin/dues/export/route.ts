import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { currentFiscalYear, fiscalYearLabel } from "@/lib/dues";
import { listMemberDuesStatus, getDuesSettings } from "@/lib/dues-queries";

/**
 * Escape a CSV cell value.
 * - Wrap in double-quotes if the value contains a comma, double-quote, or newline.
 * - Escape internal double-quotes by doubling them.
 */
function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * GET /api/admin/dues/export?fy=2026
 *
 * CSV download of dues status for all active members in a fiscal year.
 * Gate: dues.manage OR reports.export
 *
 * Columns: Member Number, Last Name, First Name, Email, Category,
 *          Total Paid ($), Expected ($), Status, Payment Count
 *
 * Hand-rolled text/csv response — no external dependency.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canExport = await hasAnyFeature(session.user.id, [
      FEATURES.DUES_MANAGE,
      FEATURES.REPORTS_EXPORT,
    ]);
    if (!canExport) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const fyParam = searchParams.get("fy");
    const fiscalYear = fyParam
      ? parseInt(fyParam, 10)
      : currentFiscalYear(new Date());

    if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid fiscal year" }, { status: 400 });
    }

    const [membersData, settings] = await Promise.all([
      listMemberDuesStatus(fiscalYear, {}),
      getDuesSettings(fiscalYear),
    ]);

    // Build CSV
    const HEADERS = [
      "Member Number",
      "Last Name",
      "First Name",
      "Email",
      "Category",
      "Total Paid ($)",
      "Expected ($)",
      "Status",
      "Fiscal Year",
    ];

    const rows: string[] = [HEADERS.map(csvCell).join(",")];

    for (const m of membersData) {
      rows.push(
        [
          csvCell(m.memberNumber),
          csvCell(m.lastName),
          csvCell(m.firstName),
          csvCell(m.email),
          csvCell(m.duesCategory),
          csvCell(centsToDisplay(m.totalPaidCents)),
          csvCell(centsToDisplay(m.expectedAmountCents)),
          csvCell(m.status),
          csvCell(fiscalYear),
        ].join(","),
      );
    }

    const csvBody = rows.join("\r\n") + "\r\n";
    const fyLabel = fiscalYearLabel(fiscalYear).replace(/[^a-zA-Z0-9-]/g, "-");
    const filename = `dues-${fyLabel}.csv`;

    // Summary comment rows (non-standard but useful for auditors)
    const settingsNote = settings
      ? `# Individual: $${centsToDisplay(settings.individualAmountCents)}  Family: $${centsToDisplay(settings.familyAmountCents)}`
      : "# No dues amounts configured for this fiscal year";

    const fullCsv = `# Westerville Lions Club — Dues Export\r\n# ${fiscalYearLabel(fiscalYear)}\r\n${settingsNote}\r\n#\r\n${csvBody}`;

    return new NextResponse(fullCsv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error generating dues CSV export:", error);
    return NextResponse.json(
      { error: "Failed to generate export" },
      { status: 500 },
    );
  }
}
