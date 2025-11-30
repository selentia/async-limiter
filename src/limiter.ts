/**
 * @file limiter.ts
 * @description Concurrency limiter with observability and safety options.
 */

import type { IdleOptions, LimiterOptions, RunOptions } from './types';
import { AbortError, IdleTimeoutError, QueueOverflowError, QueueTimeoutError } from './errors';

type Defer = {
  resolve: () => boolean;
  reject: (err: unknown) => boolean;
};

type QueueEntry = {
  defer: Defer;
  removed: boolean;
  cleanup: (() => void)[];
  remove: () => void;
};

function now() {
  return Date.now();
}

function assertValidLimit(limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError(`Limiter limit must be a positive finite number. Received: ${limit}`);
  }
}

function assertValidMaxQueue(maxQueue: number) {
  if ((maxQueue !== Number.POSITIVE_INFINITY && !Number.isFinite(maxQueue)) || maxQueue < 0) {
    throw new RangeError(
      `Limiter maxQueue must be a number >= 0 (or Infinity). Received: ${maxQueue}`
    );
  }
}

function assertValidTimeoutMs(name: string, ms: number | undefined) {
  if (ms == null) return;
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`${name} must be a finite number >= 0 (or undefined). Received: ${ms}`);
  }
}

function makeQueueEntry(defer: Defer): QueueEntry {
  const entry: QueueEntry = {
    defer,
    removed: false,
    cleanup: [],
    remove: () => {
      if (entry.removed) return;
      entry.removed = true;
      for (const fn of entry.cleanup.splice(0)) fn();
    },
  };
  return entry;
}

function addAbortHandler(signal: AbortSignal | undefined, onAbort: () => void): (() => void) | null {
  if (!signal) return null;
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export class Limiter {
  private active = 0;
  private queue: QueueEntry[] = [];

  private readonly limit: number;
  private readonly maxQueue: number;
  private readonly defaultQueueTimeoutMs?: number;
  private readonly defaultSignal?: AbortSignal;

  private idleWaiters = new Set<() => void>();

  constructor(limit: number, options: LimiterOptions = {}) {
    assertValidLimit(limit);

    const { maxQueue = Number.POSITIVE_INFINITY, queueTimeoutMs = undefined, signal = undefined } =
      options;

    assertValidMaxQueue(maxQueue);
    assertValidTimeoutMs('queueTimeoutMs', queueTimeoutMs);

    this.limit = limit;
    this.maxQueue = maxQueue;
    this.defaultQueueTimeoutMs = queueTimeoutMs;
    this.defaultSignal = signal;
  }

  get activeCount() {
    return this.active;
  }

  get pendingCount() {
    return this.queue.length;
  }

  /**
   * Run a task within the concurrency limit.
   *
   * - Supports both sync and async functions.
   * - `signal` and `queueTimeoutMs` apply only while waiting in the queue (not while running).
   */
  async run<T>(fn: () => T | Promise<T>, options: RunOptions = {}): Promise<T> {
    const signal = options.signal ?? this.defaultSignal;
    const queueTimeoutMs = options.queueTimeoutMs ?? this.defaultQueueTimeoutMs;

    assertValidTimeoutMs('queueTimeoutMs', queueTimeoutMs);

    if (signal?.aborted) throw new AbortError('Task aborted before start');

    await this.acquire({ signal, queueTimeoutMs });

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Resolve when the limiter becomes idle (`activeCount === 0 && pendingCount === 0`).
   */
  async onIdle(options: IdleOptions = {}): Promise<void> {
    const { signal, timeoutMs } = options;
    assertValidTimeoutMs('timeoutMs', timeoutMs);

    if (signal?.aborted) throw new AbortError('Idle wait aborted');
    if (this.active === 0 && this.queue.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      let done = false;

      const cleanups: Array<() => void> = [];
      function cleanup() {
        for (const fn of cleanups.splice(0)) fn();
      }

      function finish(err?: unknown) {
        if (done) return;
        done = true;
        cleanup();
        if (err) reject(err);
        else resolve();
      }

      const waiter = () => finish();
      this.idleWaiters.add(waiter);
      cleanups.push(() => this.idleWaiters.delete(waiter));

      const rmAbort = addAbortHandler(signal, () => finish(new AbortError('Idle wait aborted')));
      if (rmAbort) cleanups.push(rmAbort);

      if (timeoutMs != null) {
        const t = setTimeout(() => finish(new IdleTimeoutError()), timeoutMs);
        cleanups.push(() => clearTimeout(t));
      }

      this.emitIdleIfNeeded();
    });
  }

  private emitIdleIfNeeded() {
    if (this.active !== 0 || this.queue.length !== 0) return;
    for (const w of Array.from(this.idleWaiters)) w();
  }

  private async acquire(args: { signal?: AbortSignal; queueTimeoutMs?: number }): Promise<void> {
    const { signal, queueTimeoutMs } = args;

    if (signal?.aborted) throw new AbortError('Task aborted before start');

    if (this.active < this.limit) {
      this.active++;
      return;
    }

    if (this.queue.length >= this.maxQueue) {
      throw new QueueOverflowError(
        `Queue overflow: pending=${this.queue.length}, maxQueue=${this.maxQueue}`
      );
    }

    await this.waitForTurn({ signal, queueTimeoutMs });
  }

  private release() {
    for (;;) {
      const next = this.shiftNext();

      if (!next) {
        this.active--;
        this.emitIdleIfNeeded();
        return;
      }

      next.remove();

      if (next.defer.resolve()) {
        return;
      }
    }
  }

  private shiftNext(): QueueEntry | undefined {
    for (;;) {
      const next = this.queue.shift();
      if (!next) return undefined;
      if (next.removed) continue;
      return next;
    }
  }

  private waitForTurn(args: { signal?: AbortSignal; queueTimeoutMs?: number }): Promise<void> {
    const { signal, queueTimeoutMs } = args;

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError('Task aborted while waiting in queue'));
        return;
      }

      let settled = false;

      const entry = makeQueueEntry({
        resolve: () => {
          if (settled) return false;
          settled = true;
          resolve();
          return true;
        },
        reject: (err) => {
          if (settled) return false;
          settled = true;
          reject(err);
          return true;
        },
      });

      const removeFromQueue = () => {
        if (entry.removed) return;
        entry.remove();
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) this.queue.splice(idx, 1);
        this.emitIdleIfNeeded();
      };

      const rmAbort = addAbortHandler(signal, () => {
        removeFromQueue();
        entry.defer.reject(new AbortError('Task aborted while waiting in queue'));
      });
      if (rmAbort) entry.cleanup.push(rmAbort);

      if (queueTimeoutMs != null) {
        const start = now();
        const t = setTimeout(() => {
          removeFromQueue();
          entry.defer.reject(new QueueTimeoutError(`Task waited ${now() - start}ms in queue`));
        }, queueTimeoutMs);

        entry.cleanup.push(() => clearTimeout(t));
      }

      this.queue.push(entry);
    });
  }
}
