/**
 * B-172 Increment 2a, pass 2: source scans that hold the sweep's single-writer
 * and firewall rules in place (DECISION-126). Comments are stripped first so
 * the explanation of a rule never trips its own scan.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Text inside every `.set(` / `.values(` call, balanced-paren extracted. */
function writeCalls(text: string): string[] {
  const out: string[] = [];
  const re = /\.(set|values)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      i += 1;
    }
    out.push(text.slice(start, i - 1));
  }
  return out;
}

const ALL = walk(SRC).map((f) => ({ file: path.relative(SRC, f), text: strip(readFileSync(f, "utf8")) }));

describe("single writer of the pointer columns", () => {
  it("no .set() or .values() call outside the sweep batch module names swept_from / sweep_leg", () => {
    const offenders: string[] = [];
    for (const { file, text } of ALL) {
      if (file === "lib/ledger-sweep-batch.ts" || file === "lib/db/schema.ts") continue;
      for (const call of writeCalls(text)) {
        if (/\b(sweptFromTxnId|sweepLegTxnId|swept_from_txn_id|sweep_leg_txn_id)\b/.test(call)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the only module that builds a pointer-carrying row literal is the carrier's buildSweepCopy, and the batch module inserts its result", () => {
    const carrier = ALL.find((f) => f.file === "lib/ledger-sweep.ts")!.text;
    const batch = ALL.find((f) => f.file === "lib/ledger-sweep-batch.ts")!.text;
    expect((carrier.match(/sweptFromTxnId:\s*source\.id/g) ?? []).length).toBe(1);
    expect((carrier.match(/sweepLegTxnId:\s*ctx\.legId/g) ?? []).length).toBe(1);
    // The batch module never assigns a pointer by hand; it inserts what buildSweepCopy returned.
    expect(batch).toContain("buildSweepCopy(");
    expect(batch).toMatch(/\.values\(copies\)/);
    for (const call of writeCalls(batch)) {
      expect(call).not.toMatch(/\b(sweptFromTxnId|sweepLegTxnId)\s*:/);
    }
  });

  it("a copy literal carries transferGroupId: null and the leg insert carries a real group id", () => {
    const carrier = ALL.find((f) => f.file === "lib/ledger-sweep.ts")!.text;
    expect(carrier).toMatch(/transferGroupId:\s*null,\s*\n\s*\};/);
    expect(carrier).toMatch(/transferGroupId:\s*null;/);
    const batch = ALL.find((f) => f.file === "lib/ledger-sweep-batch.ts")!.text;
    const legInsert = writeCalls(batch).find((c) => /flow:\s*"expense"/.test(c));
    expect(legInsert).toBeDefined();
    expect(legInsert).toMatch(/\btransferGroupId,/);
    expect(legInsert).not.toMatch(/transferGroupId:\s*null/);
    expect(batch).toMatch(/const transferGroupId = crypto\.randomUUID\(\)/);
  });
});

describe("member-surface firewall", () => {
  it("ledger-sweep-batch is imported by no member page, member route or financial-report module", () => {
    const offenders = ALL.filter(
      ({ file, text }) =>
        (file.startsWith("app/members") || file.startsWith("app/api/members") || /^lib\/financial-report-/.test(file)) &&
        /ledger-sweep-batch/.test(text),
    ).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("only the sweep routes and the read-only pages import ledger-sweep-batch from app code (B15)", () => {
    const importers = ALL.filter(({ file, text }) => file.startsWith("app/") && /["']@\/lib\/ledger-sweep-batch["']/.test(text)).map((f) => f.file);
    const READ_PAGES = [
      "app/(dashboard)/admin/ledger/sweep/page.tsx",
      "app/(dashboard)/admin/ledger/approvals/page.tsx",
    ];
    expect(
      importers.every((f) => f.startsWith("app/api/admin/ledger/sweep-batches/") || READ_PAGES.includes(f)),
    ).toBe(true);
    // Five routes plus the builder page (2b pass 1) and the Approvals page (2b pass 2): seven, no further.
    expect(importers.length).toBe(7);
    expect(READ_PAGES).toHaveLength(2);
  });

  it("the builder page imports only named read exports from ledger-sweep-batch (B15)", () => {
    const text = strip(read("app/(dashboard)/admin/ledger/sweep/page.tsx"));
    const m = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/ledger-sweep-batch["']/.exec(text);
    expect(m).not.toBeNull();
    const names = m![1].split(",").map((n) => n.trim()).filter(Boolean).sort();
    expect(names).toEqual(["listSweepCandidates", "listSweepCloseouts", "resolveSweepFunds"]);
    for (const writer of ["createSweepBatch", "voidSweepBatch", "markSweepCloseouts", "unmarkSweepCloseouts"]) {
      expect(text).not.toContain(writer);
    }
  });

  it("the Approvals page imports only getSweepBatchDetail from ledger-sweep-batch and keeps its own gate (B15, B8)", () => {
    const text = strip(read("app/(dashboard)/admin/ledger/approvals/page.tsx"));
    const m = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/ledger-sweep-batch["']/.exec(text);
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((n) => n.trim()).filter(Boolean)).toEqual(["getSweepBatchDetail"]);
    for (const writer of ["createSweepBatch", "voidSweepBatch", "markSweepCloseouts", "unmarkSweepCloseouts"]) {
      expect(text).not.toContain(writer);
    }
    // Batch rows are read through getSweepBatchDetail, and the page keeps auth() then hasFeature().
    expect(text).toContain("getSweepBatchDetail(db, p.id)");
    expect(text.indexOf("await auth()")).toBeLessThan(text.indexOf("hasFeature("));
    // One shared actions block for the card and the table (the xl bug class): the page mounts it once per rendering.
    expect(text).toContain("<ApprovalCard");
    expect(text).toContain("<ApprovalActions");
  });

  it("the register and donor pages read badges through ledger-sweep-link, never the batch module", () => {
    for (const rel of ["app/(dashboard)/admin/ledger/[fundSlug]/page.tsx", "app/(dashboard)/admin/ledger/donors/[id]/page.tsx"]) {
      const text = strip(read(rel));
      expect(text).not.toMatch(/ledger-sweep-batch/);
    }
    expect(strip(read("app/(dashboard)/admin/ledger/[fundSlug]/page.tsx"))).toContain("listSweepBadges(");
  });

  it("no client component imports the batch module or writes a pointer column", () => {
    const offenders = ALL.filter(
      ({ file, text }) =>
        file.startsWith("components/") &&
        (/ledger-sweep-batch|ledger-sweep-link/.test(text) || /sweptFromTxnId|sweepLegTxnId\s*[:=]/.test(text)),
    ).map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});

describe("the five routes", () => {
  const routes = [
    "app/api/admin/ledger/sweep-batches/preview/route.ts",
    "app/api/admin/ledger/sweep-batches/route.ts",
    "app/api/admin/ledger/sweep-batches/[legId]/route.ts",
    "app/api/admin/ledger/sweep-batches/[legId]/void/route.ts",
    "app/api/admin/ledger/sweep-batches/closeouts/route.ts",
  ];

  it.each(routes)("%s opens with the shared gate and does not touch the database directly for writes", (rel) => {
    const text = strip(read(rel));
    const handler = text.slice(text.search(/export async function (GET|POST)/));
    // The first statement after `try {` is the gate.
    expect(handler).toMatch(/try \{\s*const gate = await authorizeSweep\(\[/);
    expect(handler.indexOf("authorizeSweep(")).toBeLessThan(handler.search(/await (request|params)|isUuid\(|\.json\(\)/));
    expect(text).not.toMatch(/\.(insert|update|delete)\(/);
    expect(text).not.toMatch(/console\.log/);
  });

  it("the gate helper is auth() then the feature check, with one identical 403 body", () => {
    const text = strip(read("lib/ledger-sweep-gate.ts"));
    expect(text.indexOf("await auth()")).toBeLessThan(text.indexOf("hasFeature("));
    expect((text.match(/\{ error: "Forbidden" \}/g) ?? []).length).toBe(1);
    expect(text).toContain("status: 401");
    expect(text).toContain("status: 403");
  });
});

describe("Increment 2b server additions", () => {
  it("only the create route sets maxDuration = 60 (B6); the notifier stays awaited", () => {
    const create = strip(read("app/api/admin/ledger/sweep-batches/route.ts"));
    expect(create).toMatch(/export const maxDuration = 60;/);
    for (const rel of [
      "app/api/admin/ledger/sweep-batches/preview/route.ts",
      "app/api/admin/ledger/sweep-batches/[legId]/route.ts",
      "app/api/admin/ledger/sweep-batches/[legId]/void/route.ts",
      "app/api/admin/ledger/sweep-batches/closeouts/route.ts",
    ]) {
      expect(strip(read(rel))).not.toMatch(/maxDuration/);
    }
    const batch = strip(read("lib/ledger-sweep-batch.ts"));
    expect(batch).toMatch(/await notifyPendingApprovers\(/);
    expect(batch).not.toMatch(/\bafter\(/);
  });

  it("the register's badge read lives in ledger-sweep-link.ts, not in the batch module (pages may import it without the writer)", () => {
    expect(strip(read("lib/ledger-sweep-link.ts"))).toMatch(/export async function listSweepBadges\(/);
    expect(strip(read("lib/ledger-sweep-batch.ts"))).not.toMatch(/listSweepBadges/);
  });
});

describe("no decision column and no second approval path", () => {
  it("neither the carrier nor the batch module writes approval or rejection columns (batches post through decideTransaction)", () => {
    for (const file of ["lib/ledger-sweep.ts", "lib/ledger-sweep-batch.ts", "lib/ledger-sweep-gate.ts"]) {
      const text = ALL.find((f) => f.file === file)!.text;
      expect(text).not.toMatch(/\b(approvedAt|approvedByUserId|rejectedAt|rejectedByUserId|rejectionReason)\s*:/);
    }
  });

  it("the lump Transfer route refuses a sweep: it imports only the carrier and holds none of the sweep-only code (B-172 Inc 2b)", () => {
    const text = strip(ALL.find((f) => f.file === "app/api/admin/ledger/transactions/route.ts")!.text);
    expect(text).toContain("async function handleTransfer(");
    expect(text).not.toMatch(/["']@\/lib\/ledger-sweep-batch["']/);
    const sweepImports = [...text.matchAll(/from\s+["'](@\/lib\/ledger-sweep[^"']*)["']/g)].map((m) => m[1]);
    expect(sweepImports).toEqual(["@/lib/ledger-sweep"]);
    expect(text).toContain("use_sweep_batch");
    expect(text).not.toContain("destCategoryId");
    expect(text).not.toContain("Public donations");
    expect(text).not.toMatch(/noun:\s*"sweep"/);
  });

  it("the transfer policy and the fund-move policy stay separate modules (the move policy borrows only the FundRef type)", () => {
    const transfer = ALL.find((f) => f.file === "lib/ledger-transfer-policy.ts")!.text;
    const move = ALL.find((f) => f.file === "lib/ledger-fund-move-policy.ts")!.text;
    expect(transfer).not.toMatch(/ledger-fund-move-policy/);
    const imports = [...move.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']@\/lib\/ledger-transfer-policy["']/g)];
    expect(imports.every((m) => Boolean(m[1]))).toBe(true);
    expect(move).not.toMatch(/checkTransferDirection/);
    expect(transfer).not.toMatch(/ledger-sweep/);
    expect(move).not.toMatch(/ledger-sweep/);
    expect(ALL.find((f) => f.file === "lib/ledger-sweep-batch.ts")!.text).not.toMatch(/ledger-fund-move-policy/);
  });
});
