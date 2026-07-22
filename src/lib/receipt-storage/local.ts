/**
 * LocalReceiptStorage adapter — DECISION-020.
 *
 * Used in local development and test (NODE_ENV !== "production" — DECISION-040).
 * Writes files under `.receipt-store/<key>` relative to the repo root.
 *
 * The `.receipt-store/` directory is gitignored so no receipt data ever
 * enters version control.
 *
 * No env var required — zero configuration for local dev.
 */

import path from "path";
import fs from "fs";
import type { ReceiptStorage } from "./index";

/** Content-type is stored in a sidecar `.ct` file alongside the blob bytes. */
const CT_SUFFIX = ".ct";

export class LocalReceiptStorage implements ReceiptStorage {
  private readonly root: string;

  constructor() {
    // Repo root is two levels above src/lib/receipt-storage/
    this.root = path.join(process.cwd(), ".receipt-store");
  }

  /** Resolve a storage key to an absolute filesystem path under .receipt-store/. */
  private resolve(key: string): string {
    // Sanitize the key to prevent path traversal:
    //   - strip any leading slashes / dots that could escape the root
    //   - normalize to forward-slash segments only
    const safe = key
      .split(/[/\\]/)
      .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
      .join(path.sep);
    return path.join(this.root, safe);
  }

  async save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
    const target = this.resolve(key);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, bytes);
    fs.writeFileSync(target + CT_SUFFIX, contentType, "utf8");
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const target = this.resolve(key);
    if (!fs.existsSync(target)) return null;
    const bytes = fs.readFileSync(target);
    const contentType = fs.existsSync(target + CT_SUFFIX)
      ? fs.readFileSync(target + CT_SUFFIX, "utf8").trim()
      : "application/octet-stream";
    return { bytes, contentType };
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    if (fs.existsSync(target + CT_SUFFIX)) fs.unlinkSync(target + CT_SUFFIX);
  }
}
