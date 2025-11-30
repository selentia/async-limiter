/**
 * @file limiter.race-internal.test.ts
 * @description Combined tests for:
 *   - Race/cleanup safety behavior
 *   - Internal/private branch coverage
 *
 * These are separated from public behavior tests to ensure that:
 *   - Race conditions and cleanup behavior remain stable across versions
 *   - Internal branches (TS-private) are explicitly covered for full V8 coverage
 *
 * Notes
 * - I intentionally use `(limiter as any)` to reach private internals.
 * - Rejection handlers are attached *before* advancing fake timers to avoid
 *   unhandled rejection warnings.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createLimit,
  Limiter,
  AbortError,
  QueueTimeoutError,
  IdleTimeoutError,
} from '../src';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Restore real timers after each test
afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------------------------------------
 *  RACE / CLEANUP SAFETY TESTS
 * ---------------------------------------------------------------------------------------------- */
describe('Limiter – race guards / cleanup stability', () => {
  it('onIdle resolves before timeout when work finishes in time (timeout properly cleaned)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const hold = limit(async () => {
      await delay(50);
    });

    const idleP = limit.onIdle({ timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(60);
    await hold;

    await expect(idleP).resolves.toBeUndefined();
  });

  it('queueTimeout rejection does not poison the limiter (subsequent tasks still run)', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const hold = limit(async () => {
      await delay(200);
    });

    const timedOut = limit(async () => delay(1), { queueTimeoutMs: 50 });
    const asrt = expect(timedOut).rejects.toBeInstanceOf(QueueTimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await asrt;

    const ran: string[] = [];
    const next = limit(async () => {
      ran.push('ok');
      await delay(10);
    });

    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([hold, next]);

    expect(ran).toEqual(['ok']);
    await expect(limit.onIdle({ timeoutMs: 50 })).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------
 *  INTERNAL / PRIVATE BRANCH COVERAGE TESTS
 * ---------------------------------------------------------------------------------------------- */
describe('Limiter – internal branch coverage', () => {
  it('waitForTurn rejects immediately when signal is already aborted', async () => {
    const limiter = new Limiter(1);

    const ac = new AbortController();
    ac.abort();

    const p = (limiter as any).waitForTurn({ signal: ac.signal });
    await expect(p).rejects.toBeInstanceOf(AbortError);
  });

  it('queue entry remove() is idempotent (covers early-return branch)', async () => {
    const limiter = new Limiter(1);

    const p = (limiter as any).waitForTurn({});
    const queue = (limiter as any).queue as any[];
    const entry = queue[0];

    const cleanup = vi.fn();
    entry.cleanup.push(cleanup);

    entry.remove();
    entry.remove(); // hit "already removed" branch

    expect(cleanup).toHaveBeenCalledTimes(1);

    const asrt = expect(p).rejects.toBeInstanceOf(Error);
    entry.defer.reject(new Error('settle pending promise'));
    await asrt;

    const idx = queue.indexOf(entry);
    if (idx >= 0) queue.splice(idx, 1);
  });

  it('defer.resolve/reject return false after settled', async () => {
    const limiter = new Limiter(1);

    const p = (limiter as any).waitForTurn({});
    const queue = (limiter as any).queue as any[];
    const entry = queue[0];

    expect(entry.defer.resolve()).toBe(true);
    await expect(p).resolves.toBeUndefined();

    // cover: if (settled) return false
    expect(entry.defer.resolve()).toBe(false);
    expect(entry.defer.reject(new Error('late'))).toBe(false);

    entry.remove();
    const idx = queue.indexOf(entry);
    if (idx >= 0) queue.splice(idx, 1);
  });

  it('shiftNext skips removed entries (covers "continue" branch)', async () => {
    const limiter = new Limiter(1);

    const p1 = (limiter as any).waitForTurn({});
    const p2 = (limiter as any).waitForTurn({});

    const queue = (limiter as any).queue as any[];
    const entry1 = queue[0];
    const entry2 = queue[1];

    entry1.remove(); // mark as removed

    const asrt1 = expect(p1).rejects.toBeInstanceOf(Error);
    entry1.defer.reject(new Error('removed'));
    await asrt1;

    const next = (limiter as any).shiftNext();
    expect(next).toBe(entry2);

    expect(entry2.defer.resolve()).toBe(true);
    await expect(p2).resolves.toBeUndefined();

    entry2.remove();
  });

  it('onIdle installs abort handler and rejects when aborted mid-wait', async () => {
    vi.useFakeTimers();

    const limit = createLimit(1);

    const hold = limit(async () => {
      await delay(200);
    });

    const ac = new AbortController();
    const idleP = limit.onIdle({ signal: ac.signal });

    const asrt = expect(idleP).rejects.toBeInstanceOf(AbortError);
    ac.abort();
    await asrt;

    await vi.advanceTimersByTimeAsync(300);
    await hold;

    expect(limit.activeCount).toBe(0);
    expect(limit.pendingCount).toBe(0);
  });
});
