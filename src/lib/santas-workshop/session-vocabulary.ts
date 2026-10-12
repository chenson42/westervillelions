export const SESSION_KINDS = ["practice", "real"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["draft", "active", "closed", "purged"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
