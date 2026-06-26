import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import { csvCellSafe } from "@/lib/csv-safe";
import {
  getEntity,
  get990Prep,
  listTransactionsForExport,
} from "@/lib/ledger-queries";

// ---------------------------------------------------------------------------
// Local CSV helpers
// ---------------------------------------------------------------------------

/**
 * Escape a CSV cell value (same logic as the dues export csvCell, but without
 * formula-injection protection — use csvCellSafe for user-supplied free-text).
 */
function csvCellRaw(value: string | number | boolean | null | undefined): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// GET /api/admin/ledger/export
// ---------------------------------------------------------------------------

/**
 * CSV export for the ledger reports page.
 *
 * Query params:
 *   entity  — entity slug ('club' | 'foundation'), validated via getEntity()
 *   fy      — fiscal year integer (2000–2100)
 *   type    — 'transactions' | '990prep'
 *
 * Auth: session required (401); LEDGER_VIEW OR REPORTS_EXPORT required (403).
 *
 * Returns Content-Type: text/csv with Cache-Control: no-store.
 * Empty FY → comment-only rows, never an error.
 */
export async function GET(request: NextRequest) {
  try {
    // --- Auth ---
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canExport = await hasAnyFeature(session.user.id, [
      FEATURES.LEDGER_VIEW,
      FEATURES.REPORTS_EXPORT,
    ]);
    if (!canExport) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // --- Param validation ---
    const { searchParams } = new URL(request.url);

    const entitySlug = searchParams.get("entity") ?? "";
    const fyParam = searchParams.get("fy") ?? "";
    const typeParam = searchParams.get("type") ?? "";

    if (!typeParam || !["transactions", "990prep"].includes(typeParam)) {
      return NextResponse.json(
        { error: "Invalid type. Use 'transactions' or '990prep'." },
        { status: 400 },
      );
    }

    const fiscalYear = parseInt(fyParam, 10);
    if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid fiscal year" }, { status: 400 });
    }

    const entity = await getEntity(entitySlug);
    if (!entity) {
      return NextResponse.json({ error: "Invalid entity" }, { status: 400 });
    }

    // FY label used in comments and filename
    const fyLabel = fiscalYearLabel(fiscalYear);
    const fyFilename = fyLabel.replace(/[^a-zA-Z0-9-]/g, "-");

    // Shared comment-header prefix
    const generated = new Date().toISOString().slice(0, 10);

    if (typeParam === "transactions") {
      return await buildTransactionsCsv(
        entity.id,
        entity.name,
        entitySlug,
        fiscalYear,
        fyLabel,
        fyFilename,
        generated,
      );
    } else {
      return await build990PrepCsv(
        entity.id,
        entity.name,
        entitySlug,
        fiscalYear,
        fyLabel,
        fyFilename,
        generated,
      );
    }
  } catch (error) {
    console.error("Error generating ledger CSV export:", error);
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Branch: type=transactions
// ---------------------------------------------------------------------------

async function buildTransactionsCsv(
  entityId: string,
  entityName: string,
  entitySlug: string,
  fiscalYear: number,
  fyLabel: string,
  fyFilename: string,
  generated: string,
): Promise<NextResponse> {
  const rows = await listTransactionsForExport(entityId, fiscalYear);

  const commentHeader = [
    `# Westerville Lions Club — Transaction Ledger Export`,
    `# Entity: ${entityName}`,
    `# Fiscal Year: ${fyLabel}`,
    `# Generated: ${generated}`,
    `# Includes all transaction statuses (posted, pending, rejected). Transfer rows show Category = "Transfer".`,
  ].join("\r\n");

  const columnHeaders = [
    "Date",
    "Fund",
    "Flow",
    "Category",
    "Party/Payee",
    "Amount ($)",
    "Status",
    "Reconciled",
    "Payment Method",
    "Memo",
  ].join(",");

  const dataRows: string[] = [];

  if (rows.length === 0) {
    dataRows.push(`# No transactions recorded for this entity and fiscal year.`);
  } else {
    for (const row of rows) {
      dataRows.push(
        [
          csvCellRaw(row.txnDate),
          csvCellRaw(row.fundName),
          csvCellRaw(row.flow),
          csvCellSafe(row.categoryDisplay),
          csvCellSafe(row.party),
          csvCellRaw(centsToDisplay(row.amountCents)),
          csvCellRaw(row.status),
          csvCellRaw(row.reconciled ? "Yes" : "No"),
          csvCellRaw(row.paymentMethod),
          csvCellSafe(row.memo),
        ].join(","),
      );
    }
  }

  const filename = `${entitySlug}-ledger-${fyFilename}.csv`;
  const csvBody =
    commentHeader + "\r\n" + columnHeaders + "\r\n" + dataRows.join("\r\n") + "\r\n";

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Branch: type=990prep
// ---------------------------------------------------------------------------

async function build990PrepCsv(
  entityId: string,
  entityName: string,
  entitySlug: string,
  fiscalYear: number,
  fyLabel: string,
  fyFilename: string,
  generated: string,
): Promise<NextResponse> {
  const prep = await get990Prep(entityId, fiscalYear);

  const grossDisplay = centsToDisplay(prep.grossReceiptsCents);
  const form990Note = `${prep.determine990Result.form} — ${prep.determine990Result.why}`;

  const commentLines = [
    `# Westerville Lions Club — 990-Prep Worksheet`,
    `# This worksheet is a cash-basis estimate from the Ledger and is intended to assist 990/990-EZ preparation.`,
    `# It is NOT the filed return. Consult your tax preparer before submitting.`,
    `# Entity: ${entityName}`,
    `# Fiscal Year: ${fyLabel}`,
    `# Generated: ${generated}`,
    `# Gross Receipts: $${grossDisplay}`,
    `# IRS Form Determination: ${form990Note}`,
  ];

  if (prep.hasUnmapped) {
    commentLines.push(
      `# Note: Some transactions have no 990-line mapping — see "Uncategorized" and "Unmapped" rows below.`,
    );
  }

  const commentHeader = commentLines.join("\r\n");
  const columnHeaders = "990 Line / Group,Flow,Total ($)";

  const dataRows: string[] = [];

  if (prep.lines.length === 0) {
    dataRows.push(`# No posted non-transfer transactions for this entity and fiscal year.`);
  } else {
    for (const line of prep.lines) {
      dataRows.push(
        [
          csvCellSafe(line.lineGroup),
          csvCellRaw(line.flow),
          csvCellRaw(centsToDisplay(line.totalCents)),
        ].join(","),
      );
    }
  }

  const filename = `${entitySlug}-990prep-${fyFilename}.csv`;
  const csvBody =
    commentHeader + "\r\n" + columnHeaders + "\r\n" + dataRows.join("\r\n") + "\r\n";

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
