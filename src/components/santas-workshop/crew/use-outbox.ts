"use client";

import { useEffect, useState } from "react";
import { Outbox, type OutboxSnapshot, type OutboxStorage } from "./outbox-core";
import { openOutboxStorage } from "./outbox-idb";
import { sendQueuedPhoto } from "./outbox-send";

export interface UseOutbox {
  outbox: Outbox;
  snapshot: OutboxSnapshot;
  durable: boolean;
  ready: boolean;
}

const NO_STORAGE: OutboxStorage = {
  put: async () => undefined,
  getAll: async () => [],
  remove: async () => undefined,
};

/**
 * Owns one Outbox and the two things it needs that only exist after mount: the
 * IndexedDB storage (opened asynchronously) and the app's "a photo arrived" callback.
 * The Outbox exists from the first render, writing through to whatever storage is
 * attached; the app waits for `ready` before it lets anyone queue a photo, so nothing
 * is ever written to the placeholder.
 */
class OutboxHost {
  private storage: OutboxStorage = NO_STORAGE;
  private sent: () => void = () => undefined;
  readonly outbox: Outbox;

  constructor(slug: string) {
    const send = sendQueuedPhoto(slug);
    this.outbox = new Outbox({
      storage: {
        put: (i) => this.storage.put(i),
        getAll: () => this.storage.getAll(),
        remove: (id) => this.storage.remove(id),
      },
      send: (item, attempt) => send(item, attempt),
      now: () => Date.now(),
      schedule: (ms, fn) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      onSent: () => this.sent(),
    });
  }

  attachStorage(storage: OutboxStorage): void {
    this.storage = storage;
  }

  onSent(fn: () => void): void {
    this.sent = fn;
  }
}

/** `onSent` runs after the server accepted a photo. */
export function useOutbox(slug: string, onSent: () => void): UseOutbox {
  const [host] = useState(() => new OutboxHost(slug));
  const { outbox } = host;
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(() => outbox.snapshot());
  const [durable, setDurable] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    host.onSent(onSent);
  });

  useEffect(() => {
    let cancelled = false;
    const unsub = outbox.subscribe(() => setSnapshot(outbox.snapshot()));
    void (async () => {
      const opened = await openOutboxStorage(slug);
      if (cancelled) return;
      host.attachStorage(opened.storage);
      setDurable(opened.durable);
      await outbox.load();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [host, outbox, slug]);

  return { outbox, snapshot, durable, ready };
}
