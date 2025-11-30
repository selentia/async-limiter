/**
 * @file index.ts
 * @description Public exports
 */

export type { LimiterOptions, RunOptions, IdleOptions } from './types';

export {
  AsyncLimiterError,
  AbortError,
  QueueOverflowError,
  QueueTimeoutError,
  IdleTimeoutError,
} from './errors';

export { Limiter } from './limiter';
export { createLimit } from './createLimit';
export type { LimitFn } from './createLimit';
