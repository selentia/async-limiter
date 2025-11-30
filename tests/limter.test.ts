/**
 * @file limter.test.ts
 * @description Public behavior tests for @selentia/async-limiter.
 *
 * Notes
 * - These tests use Vitest fake timers to deterministically control time-based behavior.
 * - Always attach rejection handlers (e.g., `expect(p).rejects...`) before advancing timers.
 *   This prevents "PromiseRejectionHandledWarning" and Vitest "Unhandled Rejection" noise.
 * - Real timers are restored after each test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createLimit,
  AbortError,
  IdleTimeoutError,
  Limiter,
  QueueOverflowError,
  QueueTimeoutError,
} from '../src';

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createLimit (public wrapper)', () => {
  it('exposes observability fields and the underlying limiter', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    expect(typeof limit).toBe('function');
    expect(limit.limiter).toBeInstanceOf(Limiter);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);

    const hold = limit(async () => {
      await delay(100);
    });

    expect(limit.activeCount).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    await hold;

    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('enforces concurrency limit (never exceeds limit)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await delay(100);
        running--;
        return i;
      })
    );

    await vi.advanceTimersByTimeAsync(1000);
    const res = await Promise.all(tasks);

    expect(res).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(maxRunning).toBe(2);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('queues tasks in FIFO order', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);
    const order: number[] = [];

    const p1 = limit(async () => {
      order.push(1);
      await delay(50);
    });

    const p2 = limit(async () => {
      order.push(2);
      await delay(10);
    });

    const p3 = limit(async () => {
      order.push(3);
      await delay(10);
    });

    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('throws QueueOverflowError when maxQueue is exceeded', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1, { maxQueue: 0 });

    const hold = limit(async () => {
      await delay(100);
    });

    const overflowed = limit(async () => {
      await delay(1);
    });

    const asrt = expect(overflowed).rejects.toBeInstanceOf(QueueOverflowError);

    await vi.advanceTimersByTimeAsync(200);
    await asrt;
    await hold;

    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('uses per-run queueTimeoutMs override (attach rejection before timers run)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1, { queueTimeoutMs: 10_000 });

    const hold = limit(async () => {
      await delay(200);
    });

    const queued = limit(async () => delay(1), { queueTimeoutMs: 50 });
    const asrt = expect(queued).rejects.toBeInstanceOf(QueueTimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await asrt;

    await vi.advanceTimersByTimeAsync(500);
    await hold;

    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('rejects with AbortError while waiting, and aborted entry does not block the queue', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const hold = limit(async () => {
      await delay(200);
    });

    const ac = new AbortController();
    const queued = limit(async () => delay(1), { signal: ac.signal });

    const asrt = expect(queued).rejects.toBeInstanceOf(AbortError);
    ac.abort();
    await asrt;

    const ran: number[] = [];
    const next = limit(async () => {
      ran.push(1);
      await delay(10);
    });

    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([hold, next]);

    expect(ran).toEqual([1]);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('onIdle resolves after currently scheduled work finishes (active/pending -> 0)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(2);

    const tasks = [limit(async () => delay(100)), limit(async () => delay(100)), limit(async () => delay(100))];

    const done: string[] = [];
    const idleP = limit.onIdle().then(() => done.push('idle'));

    await vi.advanceTimersByTimeAsync(10);
    expect(done).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(tasks);

    await idleP;
    expect(done).toEqual(['idle']);
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('onIdle resolves immediately if already idle', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    await expect(limit.onIdle()).resolves.toBeUndefined();
    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('onIdle rejects with IdleTimeoutError when timeoutMs elapses', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const hold = limit(async () => {
      await delay(200);
    });

    const idleP = limit.onIdle({ timeoutMs: 50 });
    const asrt = expect(idleP).rejects.toBeInstanceOf(IdleTimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await asrt;

    await vi.advanceTimersByTimeAsync(300);
    await hold;

    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });

  it('rejects immediately with AbortError if signal is already aborted (run)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const ac = new AbortController();
    ac.abort();

    const p = limit(async () => delay(1), { signal: ac.signal });
    await expect(p).rejects.toBeInstanceOf(AbortError);
  });

  it('onIdle rejects immediately with AbortError if signal is already aborted', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const ac = new AbortController();
    ac.abort();

    await expect(limit.onIdle({ signal: ac.signal })).rejects.toBeInstanceOf(AbortError);
  });
});

describe('Limiter (input validation)', () => {
  it('throws RangeError on invalid limit', () => {
    expect(() => new Limiter(0)).toThrow(RangeError);
    expect(() => new Limiter(-1)).toThrow(RangeError);
    expect(() => new Limiter(Number.NaN)).toThrow(RangeError);
  });

  it('throws RangeError on invalid maxQueue', () => {
    expect(() => new Limiter(1, { maxQueue: -1 })).toThrow(RangeError);
    expect(() => new Limiter(1, { maxQueue: Number.NaN })).toThrow(RangeError);
  });

  it('throws RangeError on invalid queueTimeoutMs / timeoutMs', async () => {
    expect(() => new Limiter(1, { queueTimeoutMs: -1 })).toThrow(RangeError);

    const limiter = new Limiter(1);
    await expect(limiter.run(async () => 1, { queueTimeoutMs: -1 })).rejects.toBeInstanceOf(RangeError);
    await expect(limiter.onIdle({ timeoutMs: -1 })).rejects.toBeInstanceOf(RangeError);
  });
});
