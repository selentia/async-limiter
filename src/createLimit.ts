/**
 * @file createLimit.ts
 * @description p-limit style wrapper
 */

import type { IdleOptions, LimiterOptions, RunOptions } from './types';
import { Limiter } from './limiter';

export type LimitFn = {
  <T>(fn: () => T | Promise<T>, options?: RunOptions): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  onIdle(options?: IdleOptions): Promise<void>;
  readonly limiter: Limiter;
};

export function createLimit(limit: number, options: LimiterOptions = {}): LimitFn {
  const limiter = new Limiter(limit, options);

  async function wrapped<T>(fn: () => T | Promise<T>, runOptions: RunOptions = {}): Promise<T> {
    return limiter.run(fn, runOptions);
  }

  Object.defineProperties(wrapped, {
    activeCount: { get: () => limiter.activeCount },
    pendingCount: { get: () => limiter.pendingCount },
    limiter: { get: () => limiter },
    onIdle: { value: (opts?: IdleOptions) => limiter.onIdle(opts) },
  });

  return wrapped as LimitFn;
}
