import { describe, expect, it } from "vitest";
import { BACKOFF_MAX_MS, Outbox, backoffMs, createMemoryStorage, type OutboxItem, type OutboxStorage, type SendOutcome } from "./outbox-core";

function item(id: string, createdAt: number, over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    photoId: id,
    kind: "check_in",
    stuffyId: `stuffy-${id}`,
    label: `Stuffy ${id}`,
    full: new Blob(["jpeg"]),
    thumb: null,
    meta: { photoId: id, expectedState: "tagged", takenAt: "2026-12-19T15:00:00.000Z", width: 100, height: 100 },
    createdAt,
    attempts: 0,
    nextAt: 0,
    status: "pending",
    message: null,
    ...over,
  };
}

/** A manual clock and timer, and a send function the test resolves by hand. */
function rig(opts: { storage?: OutboxStorage; maxInFlight?: number } = {}) {
  let now = 1_000;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const calls: { id: string; attempt: number; resolve: (o: SendOutcome) => void }[] = [];
  const sent: string[] = [];
  const storage = opts.storage ?? createMemoryStorage();
  const outbox = new Outbox({
    storage,
    maxInFlight: opts.maxInFlight,
    now: () => now,
    schedule: (ms, fn) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    send: (it, attempt) => new Promise<SendOutcome>((resolve) => calls.push({ id: it.photoId, attempt, resolve })),
    onSent: (it) => sent.push(it.photoId),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.cancelled && x.at <= now)) {
      t.cancelled = true;
      t.fn();
    }
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { outbox, storage, calls, sent, advance, flush, now: () => now };
}

describe("outbox", () => {
  it("writes the photo to storage before any send, and enqueue resolves only after the write", async () => {
    const order: string[] = [];
    const base = createMemoryStorage();
    const storage: OutboxStorage = {
      ...base,
      async put(i) {
        order.push("put");
        await base.put(i);
      },
    };
    const r = rig({ storage });
    const original = r.outbox;
    expect(original).toBeTruthy();
    await r.outbox.enqueue(item("a", 1));
    expect(order[0]).toBe("put");
    expect(base.rows.has("a")).toBe(true);
    expect(r.calls.length).toBe(1); // the send started only after the put resolved
  });

  it("lets the worker go on: enqueue resolves while the upload is still running", async () => {
    const r = rig();
    const result = await r.outbox.enqueue(item("a", 1));
    expect(result).toBe("queued");
    expect(r.outbox.snapshot().waiting).toBe(1);
    expect(r.outbox.snapshot().items[0].sending).toBe(true);
  });

  it("sends at most two at a time, first in first out", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    await r.outbox.enqueue(item("b", 2));
    await r.outbox.enqueue(item("c", 3));
    expect(r.calls.map((c) => c.id)).toEqual(["a", "b"]);
    r.calls[0].resolve({ kind: "sent" });
    await r.flush();
    expect(r.calls.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("removes a sent photo from storage and reports it", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    r.calls[0].resolve({ kind: "sent" });
    await r.flush();
    expect(r.sent).toEqual(["a"]);
    expect(r.outbox.snapshot().waiting).toBe(0);
    expect((r.storage as ReturnType<typeof createMemoryStorage>).rows.size).toBe(0);
  });

  it("retries with the SAME photo id and a rising attempt count after a backoff", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    expect(r.calls[0]).toMatchObject({ id: "a", attempt: 1 });
    r.calls[0].resolve({ kind: "retry" });
    await r.flush();
    expect(r.calls.length).toBe(1);
    r.advance(backoffMs(1) - 1);
    await r.flush();
    expect(r.calls.length).toBe(1);
    r.advance(1);
    await r.flush();
    expect(r.calls[1]).toMatchObject({ id: "a", attempt: 2 });
    r.calls[1].resolve({ kind: "retry" });
    await r.flush();
    r.advance(backoffMs(2));
    await r.flush();
    expect(r.calls[2]).toMatchObject({ id: "a", attempt: 3 });
  });

  it("treats a send that throws as a retry, not a loss", async () => {
    const storage = createMemoryStorage();
    let now = 0;
    const outbox = new Outbox({
      storage,
      now: () => now,
      schedule: () => () => undefined,
      send: async () => {
        throw new Error("boom");
      },
    });
    await outbox.enqueue(item("a", 1));
    await new Promise((r) => setTimeout(r, 0));
    now = 0;
    expect(outbox.snapshot().waiting).toBe(1);
    expect(outbox.snapshot().items[0].attempts).toBe(1);
    expect(storage.rows.get("a")?.attempts).toBe(1);
  });

  it("caps the backoff", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(20)).toBe(BACKOFF_MAX_MS);
  });

  it("survives a reload: a new Outbox over the same storage finds the waiting photos and counts them", async () => {
    const storage = createMemoryStorage();
    const first = rig({ storage });
    await first.outbox.enqueue(item("a", 1));
    await first.outbox.enqueue(item("b", 2));
    const second = rig({ storage });
    expect(second.outbox.snapshot().waiting).toBe(0);
    await second.outbox.load();
    expect(second.outbox.snapshot().waiting).toBe(2);
    expect(second.calls.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("stops AUTOMATIC retry when storage is not set up, keeps every photo, and resumes on Try again", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    await r.outbox.enqueue(item("b", 2));
    r.calls[0].resolve({ kind: "stop", message: "Photos can't be saved right now." });
    await r.flush();
    const snap = r.outbox.snapshot();
    expect(snap.autoRetryStopped).toBe(true);
    expect(snap.waiting).toBe(2);
    await r.outbox.enqueue(item("c", 3));
    // b was already in flight; c must not start while auto retry is stopped.
    expect(r.calls.map((c) => c.id)).toEqual(["a", "b"]);
    r.advance(10 * 60_000);
    await r.flush();
    expect(r.calls.length).toBe(2);
    r.outbox.retryNow();
    await r.flush();
    expect(r.outbox.snapshot().autoRetryStopped).toBe(false);
    r.calls[1].resolve({ kind: "sent" }); // b finishes, freeing a slot for c
    await r.flush();
    expect(r.calls.map((c) => c.id)).toContain("c");
    expect(r.calls.filter((c) => c.id === "a").length).toBe(2);
  });

  it("parks a stale-state photo with its message, does not retry it, and still sends the others", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    await r.outbox.enqueue(item("b", 2));
    r.calls[0].resolve({ kind: "stale", message: "Someone else checked this one in." });
    await r.flush();
    const parked = r.outbox.snapshot().items.find((i) => i.photoId === "a");
    expect(parked).toMatchObject({ status: "parked", message: "Someone else checked this one in." });
    r.advance(10 * 60_000);
    await r.flush();
    expect(r.calls.filter((c) => c.id === "a").length).toBe(1);
    r.outbox.retryItem("a");
    await r.flush();
    expect(r.calls.filter((c) => c.id === "a").length).toBe(2);
  });

  it("parks a rejected photo (too large, not a JPEG)", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    r.calls[0].resolve({ kind: "reject", message: "That photo couldn't be read." });
    await r.flush();
    expect(r.outbox.snapshot().items[0].status).toBe("parked");
  });

  it("holds the whole queue on a 401 until resume, keeping every photo", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1));
    await r.outbox.enqueue(item("b", 2));
    await r.outbox.enqueue(item("c", 3));
    r.calls[0].resolve({ kind: "auth", message: "The worker code was changed." });
    await r.flush();
    expect(r.outbox.snapshot().heldForSignIn).toBe(true);
    expect(r.outbox.snapshot().waiting).toBe(3);
    r.calls[1].resolve({ kind: "retry" });
    await r.flush();
    r.advance(60_000);
    await r.flush();
    expect(r.calls.map((c) => c.id)).toEqual(["a", "b"]); // nothing new started while held
    r.outbox.resume();
    await r.flush();
    expect(r.outbox.snapshot().heldForSignIn).toBe(false);
    expect(r.calls.length).toBeGreaterThan(2);
  });

  it("never queues one photo id twice", async () => {
    const r = rig();
    expect(await r.outbox.enqueue(item("a", 1))).toBe("queued");
    expect(await r.outbox.enqueue(item("a", 5))).toBe("duplicate");
    expect(r.outbox.snapshot().waiting).toBe(1);
    expect(r.calls.length).toBe(1);
  });

  it("does not hold an id when the storage write fails, and rethrows", async () => {
    const storage: OutboxStorage = {
      async put() {
        throw new Error("quota");
      },
      async getAll() {
        return [];
      },
      async remove() {},
    };
    const r = rig({ storage });
    await expect(r.outbox.enqueue(item("a", 1))).rejects.toThrow("quota");
    expect(r.outbox.snapshot().waiting).toBe(0);
    expect(r.calls.length).toBe(0);
  });

  it("discard removes a photo from the phone", async () => {
    const r = rig();
    await r.outbox.enqueue(item("a", 1, { status: "parked" }));
    await r.outbox.discard("a");
    expect(r.outbox.snapshot().waiting).toBe(0);
    expect((r.storage as ReturnType<typeof createMemoryStorage>).rows.size).toBe(0);
  });

  it("restores a persisted storage stop on load", async () => {
    const storage = createMemoryStorage([item("a", 1, { status: "stopped", attempts: 1 })]);
    const r = rig({ storage });
    await r.outbox.load();
    expect(r.outbox.snapshot().autoRetryStopped).toBe(true);
    expect(r.calls.length).toBe(0);
  });

  it("notifies subscribers of every change", async () => {
    const r = rig();
    let n = 0;
    const off = r.outbox.subscribe(() => (n += 1));
    await r.outbox.enqueue(item("a", 1));
    expect(n).toBeGreaterThan(0);
    off();
    const before = n;
    r.calls[0].resolve({ kind: "sent" });
    await r.flush();
    expect(n).toBe(before);
  });
});
