/**
 * The photo outbox, PURE: the queue logic with storage, sending, the clock and
 * the timer all injected, so it is unit-tested in node. The browser wires it to
 * IndexedDB (outbox-idb.ts) and to fetch (outbox-send.ts).
 *
 * Rules (Phase 3, "Worker (crew) app"):
 *  - a photo is written to storage BEFORE any network call; `enqueue` resolves
 *    only after that write, and the worker may scan the next sticker at once;
 *  - FIFO among the items that are due, at most `maxInFlight` (2) at a time;
 *  - a retry reuses the same `photoId` and a rising attempt count (the server
 *    and the photo store dedupe on both) with exponential backoff;
 *  - `stop` (storage not set up / full: not retryable) halts AUTOMATIC retries
 *    for everything until a person taps Retry; the photos stay on the phone;
 *  - `stale` (the stuffy moved on) and `reject` (too large, not a JPEG) PARK the
 *    item with a message; it is not retried and a person decides;
 *  - `auth` (401) holds the whole queue until `resume()` after a fresh sign-in;
 *  - one photo id is never queued twice.
 * The state of a stuffy in the UI never advances here: only the server's answer
 * (the `onSent` callback) refreshes the roster.
 */

import type { CheckInMeta, GroupPhotoMeta, PhotoKind, PortraitMeta } from "@/lib/santas-workshop/crew-contract";

export type OutboxStatus = "pending" | "parked" | "stopped";

export interface OutboxItem {
  /** Also the idempotency key of the upload. */
  photoId: string;
  kind: PhotoKind;
  stuffyId: string | null;
  /** What the worker sees in the list ("Pip the Bear"). */
  label: string;
  full: Blob;
  thumb: Blob | null;
  meta: CheckInMeta | PortraitMeta | GroupPhotoMeta;
  /** Epoch ms the photo was captured: the FIFO order. */
  createdAt: number;
  /** Sends already made. The next send carries `attempts + 1` in x-sw-attempt. */
  attempts: number;
  /** Epoch ms before which the item is not retried. */
  nextAt: number;
  status: OutboxStatus;
  message: string | null;
}

export interface OutboxStorage {
  put(item: OutboxItem): Promise<void>;
  getAll(): Promise<OutboxItem[]>;
  remove(photoId: string): Promise<void>;
}

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "retry"; message?: string }
  | { kind: "stop"; message: string }
  | { kind: "stale"; message: string }
  | { kind: "reject"; message: string }
  | { kind: "auth"; message: string };

export interface OutboxDeps {
  storage: OutboxStorage;
  /** `attempt` is 1 for the first send and rises on each retry. Must not throw; a throw is treated as a retry. */
  send(item: OutboxItem, attempt: number): Promise<SendOutcome>;
  now(): number;
  /** Runs `fn` after `ms`; returns a canceller. */
  schedule(ms: number, fn: () => void): () => void;
  maxInFlight?: number;
  /** Called after the server accepted a photo (and the item left storage). */
  onSent?(item: OutboxItem): void;
}

export interface OutboxSnapshotItem {
  photoId: string;
  kind: PhotoKind;
  stuffyId: string | null;
  label: string;
  status: OutboxStatus;
  attempts: number;
  message: string | null;
  sending: boolean;
}

export interface OutboxSnapshot {
  /** Every photo that exists only on this phone. */
  waiting: number;
  items: OutboxSnapshotItem[];
  /** True while a 401 holds the queue. */
  heldForSignIn: boolean;
  /** True when automatic retry was stopped by a storage problem that is not temporary. */
  autoRetryStopped: boolean;
}

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

/** 2 s, 4 s, 8 s ... capped at 60 s, by the number of sends already made. */
export function backoffMs(attemptsMade: number): number {
  if (attemptsMade <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attemptsMade - 1));
}

export class Outbox {
  private items = new Map<string, OutboxItem>();
  private inFlight = new Set<string>();
  private listeners = new Set<() => void>();
  private held = false;
  private stoppedAuto = false;
  private cancelTimer: (() => void) | null = null;
  private readonly max: number;

  constructor(private readonly deps: OutboxDeps) {
    this.max = deps.maxInFlight ?? 2;
  }

  /** Reads what a previous page load left in storage. Anything that was mid-send is simply pending again. */
  async load(): Promise<void> {
    const stored = await this.deps.storage.getAll();
    for (const it of stored) {
      if (this.items.has(it.photoId)) continue;
      this.items.set(it.photoId, it);
      if (it.status === "stopped") this.stoppedAuto = true;
    }
    this.emit();
    this.pump();
  }

  /** Writes first, then queues. Resolves "duplicate" (and does nothing) when the photo id is already queued. */
  async enqueue(item: OutboxItem): Promise<"queued" | "duplicate"> {
    if (this.items.has(item.photoId)) return "duplicate";
    this.items.set(item.photoId, item); // reserve the id so a double tap cannot queue twice while the write is pending
    try {
      await this.deps.storage.put(item);
    } catch (e) {
      this.items.delete(item.photoId);
      this.emit();
      throw e;
    }
    this.emit();
    this.pump();
    return "queued";
  }

  snapshot(): OutboxSnapshot {
    const items = [...this.items.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((i) => ({
        photoId: i.photoId,
        kind: i.kind,
        stuffyId: i.stuffyId,
        label: i.label,
        status: i.status,
        attempts: i.attempts,
        message: i.message,
        sending: this.inFlight.has(i.photoId),
      }));
    return { waiting: items.length, items, heldForSignIn: this.held, autoRetryStopped: this.stoppedAuto };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** After the worker signs in again. */
  resume(): void {
    this.held = false;
    this.emit();
    this.pump();
  }

  /** A person tapped Retry: clears the storage stop and sends everything that is not parked now. */
  retryNow(): void {
    this.stoppedAuto = false;
    for (const it of this.items.values()) {
      if (it.status === "stopped") this.update(it.photoId, { status: "pending", nextAt: 0, message: null });
    }
    this.emit();
    this.pump();
  }

  /** Retry one parked item (a person chose to). */
  retryItem(photoId: string): void {
    if (!this.items.has(photoId)) return;
    this.update(photoId, { status: "pending", nextAt: 0, message: null });
    this.emit();
    this.pump();
  }

  /** Throw one photo away (a person chose to). */
  async discard(photoId: string): Promise<void> {
    if (!this.items.delete(photoId)) return;
    await this.deps.storage.remove(photoId);
    this.emit();
  }

  /** Schedules and starts whatever is due. Safe to call at any time. */
  pump(): void {
    if (this.held) return;
    const now = this.deps.now();
    const due = [...this.items.values()]
      .filter((i) => i.status === "pending" && !this.inFlight.has(i.photoId) && i.nextAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (this.inFlight.size < this.max && due.length > 0) {
      if (this.stoppedAuto) break;
      const next = due.shift();
      if (next) void this.run(next);
    }
    this.armTimer();
  }

  private armTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (this.held || this.stoppedAuto) return;
    const now = this.deps.now();
    let soonest = Infinity;
    for (const i of this.items.values()) {
      if (i.status === "pending" && !this.inFlight.has(i.photoId) && i.nextAt > now) soonest = Math.min(soonest, i.nextAt);
    }
    if (soonest !== Infinity) this.cancelTimer = this.deps.schedule(Math.max(0, soonest - now), () => this.pump());
  }

  private async run(item: OutboxItem): Promise<void> {
    this.inFlight.add(item.photoId);
    this.emit();
    let outcome: SendOutcome;
    try {
      outcome = await this.deps.send(item, item.attempts + 1);
    } catch {
      outcome = { kind: "retry" };
    }
    this.inFlight.delete(item.photoId);
    switch (outcome.kind) {
      case "sent": {
        this.items.delete(item.photoId);
        await this.safeRemove(item.photoId);
        this.emit();
        this.deps.onSent?.(item);
        break;
      }
      case "retry": {
        const attempts = item.attempts + 1;
        await this.updateAndPersist(item.photoId, {
          attempts,
          nextAt: this.deps.now() + backoffMs(attempts),
          message: outcome.message ?? null,
        });
        break;
      }
      case "stop": {
        this.stoppedAuto = true;
        await this.updateAndPersist(item.photoId, { attempts: item.attempts + 1, status: "stopped", message: outcome.message });
        break;
      }
      case "stale":
      case "reject": {
        await this.updateAndPersist(item.photoId, { attempts: item.attempts + 1, status: "parked", message: outcome.message });
        break;
      }
      case "auth": {
        this.held = true;
        await this.updateAndPersist(item.photoId, { message: outcome.message });
        break;
      }
    }
    this.emit();
    this.pump();
  }

  private update(photoId: string, patch: Partial<OutboxItem>): OutboxItem | null {
    const cur = this.items.get(photoId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.items.set(photoId, next);
    return next;
  }

  private async updateAndPersist(photoId: string, patch: Partial<OutboxItem>): Promise<void> {
    const next = this.update(photoId, patch);
    if (!next) return;
    try {
      await this.deps.storage.put(next);
    } catch {
      // The in-memory copy still retries; a failed bookkeeping write must not lose the photo.
    }
  }

  private async safeRemove(photoId: string): Promise<void> {
    try {
      await this.deps.storage.remove(photoId);
    } catch {
      // The server already has the photo; a leftover row is replayed harmlessly by its photo id.
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export function createMemoryStorage(initial: OutboxItem[] = []): OutboxStorage & { rows: Map<string, OutboxItem> } {
  const rows = new Map(initial.map((i) => [i.photoId, i]));
  return {
    rows,
    async put(item) {
      rows.set(item.photoId, item);
    },
    async getAll() {
      return [...rows.values()];
    },
    async remove(photoId) {
      rows.delete(photoId);
    },
  };
}
