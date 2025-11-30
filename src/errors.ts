/**
 * @file errors.ts
 * @description async-limiter errors (exported)
 */

export type AsyncLimiterErrorCode =
  | 'ERR_ASYNC_LIMITER_QUEUE_OVERFLOW'
  | 'ERR_ASYNC_LIMITER_QUEUE_TIMEOUT'
  | 'ERR_ASYNC_LIMITER_ABORTED'
  | 'ERR_ASYNC_LIMITER_IDLE_TIMEOUT';

export class AsyncLimiterError extends Error {
  public readonly code: AsyncLimiterErrorCode;

  constructor(message: string, code: AsyncLimiterErrorCode) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class QueueOverflowError extends AsyncLimiterError {
  constructor(message = 'Queue overflow: too many tasks are waiting') {
    super(message, 'ERR_ASYNC_LIMITER_QUEUE_OVERFLOW');
  }
}

export class QueueTimeoutError extends AsyncLimiterError {
  constructor(message = 'Queue timeout: task waited too long before execution') {
    super(message, 'ERR_ASYNC_LIMITER_QUEUE_TIMEOUT');
  }
}

/**
 * A lightweight AbortError compatible with typical "AbortError" checks.
 * Note: DOMException('AbortError') is not consistently available across runtimes,
 * so we provide our own.
 */
export class AbortError extends AsyncLimiterError {
  constructor(message = 'Aborted') {
    super(message, 'ERR_ASYNC_LIMITER_ABORTED');
    this.name = 'AbortError';
  }
}

export class IdleTimeoutError extends AsyncLimiterError {
  constructor(message = 'Idle timeout: limiter did not become idle in time') {
    super(message, 'ERR_ASYNC_LIMITER_IDLE_TIMEOUT');
  }
}
