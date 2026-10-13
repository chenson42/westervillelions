/**
 * Typed photo-store failures. The route layer maps these to
 * `503 { code: 'storage_unavailable' | 'storage_misconfigured' | 'storage_full' | 'storage_rate_limited' }`.
 * No message ever carries key material, a file id or a request body: the
 * messages below are fixed strings.
 */

export type StorageErrorCode = "storage_unavailable" | "storage_misconfigured" | "storage_full" | "storage_rate_limited";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  /** True when the same request may succeed later (the phone outbox keeps retrying). */
  readonly retryable: boolean;
  constructor(code: StorageErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
  }
}

export class StorageUnavailable extends StorageError {
  constructor() {
    super("storage_unavailable", "Photo storage is not answering", true);
  }
}

export class StorageMisconfigured extends StorageError {
  constructor(message = "Photo storage is not configured") {
    super("storage_misconfigured", message, false);
  }
}

export class StorageFull extends StorageError {
  constructor() {
    super("storage_full", "Photo storage is full", false);
  }
}

export class StorageRateLimited extends StorageError {
  constructor() {
    super("storage_rate_limited", "Photo storage is limiting requests", true);
  }
}

export function isStorageError(e: unknown): e is StorageError {
  return e instanceof StorageError;
}
