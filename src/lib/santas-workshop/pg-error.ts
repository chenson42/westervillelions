/** Postgres foreign-key violation (SQLSTATE 23503), however the driver wraps it. */
export function isForeignKeyViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23503" || err?.cause?.code === "23503";
}
