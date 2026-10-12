// Development-only clock override so QA can see each state before December.
// Read from the server environment, never from the URL, and ignored in
// production.

const STRICT_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function workshopNow(
  env: { NODE_ENV?: string; SANTAS_WORKSHOP_NOW?: string },
  real: Date,
): Date {
  if (env.NODE_ENV === "production") return real;
  const raw = env.SANTAS_WORKSHOP_NOW;
  if (!raw || !STRICT_ISO_INSTANT.test(raw)) return real;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? real : new Date(ms);
}
