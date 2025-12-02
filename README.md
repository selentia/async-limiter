# @selentia/async-limiter

<p align="center">
  <img src="https://img.shields.io/badge/coverage-100%25%20stmts%20%7C%2097.27%25%20branches-brightgreen" />
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" />
</p>

A zero-runtime-dependency concurrency limiter for Node.js and browsers.  
It supports **FIFO queueing**, **AbortSignal-based cancellation and wait timeouts (queueing and `onIdle()`)**, and idle waiting via **`onIdle()`**.  
Runs on Node.js ≥18 and modern browsers.

> Used in production by [Pastellink](https://pastellink.duna.me), a Discord bot trusted by 2,500+ servers.

📄 **Other languages**:
- [🇰🇷 한국어 문서](./docs/README.KO.md)

---

## Table of Contents
- [Install](#install)
- [Quick Start](#quick-start)
  - [`createLimit` (p-limit style)](#createlimit-p-limit-style)
  - [`Limiter` class](#limiter-class)
- [API](#api)
  - [`createLimit(limit, options?) → LimitFn`](#createlimitlimit-options--limitfn)
  - [`LimitFn`](#limitfn)
  - [`new Limiter(limit, options?)`](#new-limiterlimit-options)
  - [`limiter.run(task, options?) → Promise<T>`](#limiterruntask-options--promiset)
  - [`limiter.onIdle(options?) → Promise<void>`](#limiteronidleoptions--promisevoid)
  - [Options](#options)
  - [Abort & Timeout semantics](#abort--timeout-semantics)
  - [Errors](#errors)
  - [Guarantees](#guarantees)
- [License](#license)

---

## Install

```bash
npm i @selentia/async-limiter
```

---

## Quick Start

### `createLimit` (p-limit style)

```ts
import { createLimit } from '@selentia/async-limiter';

const limit = createLimit(5);

await Promise.all([
  limit(() => fetch('/a')),
  limit(() => fetch('/b')),
]);
```

### `Limiter` class

```ts
import { Limiter } from '@selentia/async-limiter';

const limiter = new Limiter(3, {
  maxQueue: 100,
  queueTimeoutMs: 2000,
});

await limiter.run(async () => {
  // ...
});

await limiter.onIdle();
```

---

## API

### `createLimit(limit, options?) → LimitFn`

`createLimit()` returns a function with the same call signature as `Limiter#run()`,
plus observability helpers:

```ts
limit.activeCount;   // number of running tasks
limit.pendingCount;  // number of queued tasks
limit.limiter;       // underlying Limiter instance
limit.onIdle();      // wait until idle
```

### `LimitFn`

```ts
import type { LimitFn } from '@selentia/async-limiter';

type LimitFn = {
  <T>(task: () => T | Promise<T>, options?: RunOptions): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  onIdle(options?: IdleOptions): Promise<void>;
  readonly limiter: Limiter;
};
```

### `new Limiter(limit, options?)`

Creates a limiter with a fixed concurrency `limit`.

### `limiter.run(task, options?) → Promise<T>`

Runs `task` under the concurrency limit.

### `limiter.onIdle(options?) → Promise<void>`

Resolves when the limiter becomes idle:

```txt
activeCount === 0 && pendingCount === 0
```

---

## Options

### `LimiterOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxQueue` | `number` | `Infinity` | Maximum number of queued tasks (running tasks are not included). |
| `queueTimeoutMs` | `number` | `undefined` | Time limit (ms) while **waiting** in the queue. |
| `signal` | `AbortSignal` | `undefined` | Default abort signal applied while **waiting** (can be overridden per call). |

### `RunOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `signal` | `AbortSignal` | `undefined` | Per-call abort signal (overrides `LimiterOptions.signal`). |
| `queueTimeoutMs` | `number` | `undefined` | Per-call queue wait timeout (overrides `LimiterOptions.queueTimeoutMs`). |

### `IdleOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `signal` | `AbortSignal` | `undefined` | Abort waiting for idle. |
| `timeoutMs` | `number` | `undefined` | Time limit (ms) for waiting until idle. |

---

## Abort & Timeout semantics

- `signal` and `queueTimeoutMs` apply **only while waiting** (i.e., before a task starts running).
- Once a task starts running, it **cannot be cancelled** by the limiter.
- Aborted / timed-out entries are removed and cleaned up, and they **never block the queue**.
- `onIdle({ signal, timeoutMs })` supports both abort and timeout while waiting for idle.

---

## Errors

Errors can be handled via `instanceof` or `error.code`.

| Error | Code | When it occurs |
|-------|------|----------------|
| `QueueOverflowError` | `ERR_ASYNC_LIMITER_QUEUE_OVERFLOW` | The queue is full (`pendingCount >= maxQueue`). |
| `QueueTimeoutError` | `ERR_ASYNC_LIMITER_QUEUE_TIMEOUT` | A task waited too long in the queue before starting. |
| `AbortError` | `ERR_ASYNC_LIMITER_ABORTED` | Aborted while waiting (queue wait or idle wait). |
| `IdleTimeoutError` | `ERR_ASYNC_LIMITER_IDLE_TIMEOUT` | The limiter did not become idle within `timeoutMs`. |

Example:

```ts
import { Limiter, QueueTimeoutError } from '@selentia/async-limiter';

const limiter = new Limiter(3);

try {
  await limiter.run(task, { queueTimeoutMs: 300 });
} catch (err) {
  if (err instanceof QueueTimeoutError) {
    // queued for too long
  }
}
```

---

## Guarantees

- Queued tasks start in **FIFO order**.  
  (Running tasks may complete in any order.)
- The concurrency limit is never exceeded.
- Aborted/timed-out tasks are fully cleaned up and never become “zombies”.
- `onIdle()` resolves only when:

```txt
activeCount === 0 && pendingCount === 0
```

---

## License

MIT
