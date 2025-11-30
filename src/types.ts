/**
 * @file types.ts
 * @description async-limiter public types
 */

export interface LimiterOptions {
  /**
   * Maximum number of tasks allowed to wait in the queue.
   * Default: Infinity
   */
  maxQueue?: number;

  /**
   * Timeout (ms) while waiting in the queue before execution starts.
   * Default: undefined (no timeout)
   */
  queueTimeoutMs?: number;

  /**
   * Abort signal applied as a default for all runs (can be overridden per-run).
   * Note: does NOT cancel running tasks; only cancels while waiting.
   */
  signal?: AbortSignal;
}

export interface RunOptions {
  /**
   * Abort signal for this call (overrides LimiterOptions.signal).
   * Note: does NOT cancel running tasks; only cancels while waiting.
   */
  signal?: AbortSignal;

  /**
   * Queue wait timeout for this call (overrides LimiterOptions.queueTimeoutMs).
   * Default: undefined (no timeout)
   */
  queueTimeoutMs?: number;
}

export interface IdleOptions {
  /**
   * Abort waiting for idle.
   */
  signal?: AbortSignal;

  /**
   * Timeout (ms) for waiting until idle.
   * Default: undefined (no timeout)
   */
  timeoutMs?: number;
}
