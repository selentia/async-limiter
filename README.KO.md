# @selentia/async-limiter

<p align="center">
  <img src="https://img.shields.io/badge/coverage-100%25%20stmts%20%7C%2097.27%25%20branches-brightgreen" />
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" />
</p>

런타임 의존성이 없는 동시성 제한 라이브러리입니다.  
**FIFO 큐잉**, **AbortSignal 기반 취소 및 대기 타임아웃(큐 대기, `onIdle()`)**, 그리고 **`onIdle()`를 통한 idle 대기**를 지원합니다.  
Node.js 18 이상 및 최신 브라우저에서 동작합니다.

> 본 라이브러리는 2,500개 이상의 서버에서 운영되는 Discord 봇 [Pastellink](https://pastellink.duna.me)에서 실제로 사용되고 있습니다.

📄 **다른 언어**:
- [🇺🇸 English](./README.md)

---

## 목차
- [설치](#설치)
- [빠른 시작](#빠른-시작)
  - [`createLimit` (p-limit 스타일)](#createlimit-p-limit-스타일)
  - [`Limiter` 클래스](#limiter-클래스)
- [API](#api)
  - [`createLimit(limit, options?) → LimitFn`](#createlimitlimit-options--limitfn)
  - [`LimitFn`](#limitfn)
  - [`new Limiter(limit, options?)`](#new-limiterlimit-options)
  - [`limiter.run(task, options?) → Promise<T>`](#limiterruntask-options--promiset)
  - [`limiter.onIdle(options?) → Promise<void>`](#limiteronidleoptions--promisevoid)
  - [옵션](#옵션)
  - [Abort / Timeout 동작 원리](#abort--timeout-동작-원리)
  - [오류](#오류)
  - [보장 사항](#보장-사항)
- [라이선스](#라이선스)

---

## 설치

```bash
npm i @selentia/async-limiter
```

---

## 빠른 시작

### `createLimit` (p-limit 스타일)

```ts
import { createLimit } from '@selentia/async-limiter';

const limit = createLimit(5);

await Promise.all([
  limit(() => fetch('/a')),
  limit(() => fetch('/b')),
]);
```

### `Limiter` 클래스

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

`createLimit()`은 `Limiter#run()`과 동일한 호출 형태를 갖는 함수를 반환하며,
다음 관찰용 프로퍼티를 함께 제공합니다.

```ts
limit.activeCount;   // 실행 중인 작업 수
limit.pendingCount;  // 큐에 대기 중인 작업 수
limit.limiter;       // 내부 Limiter 인스턴스
limit.onIdle();      // idle 상태까지 대기
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

고정된 동시 실행 제한(`limit`)을 갖는 리미터를 생성합니다.

### `limiter.run(task, options?) → Promise<T>`

동시 실행 제한을 지키면서 `task`를 실행합니다.

### `limiter.onIdle(options?) → Promise<void>`

리미터가 다음 조건을 만족할 때 resolve됩니다.

```txt
activeCount === 0 && pendingCount === 0
```

---

## 옵션

### `LimiterOptions`

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `maxQueue` | `number` | `Infinity` | 큐에 대기할 수 있는 최대 작업 수입니다(실행 중 작업은 포함하지 않음). |
| `queueTimeoutMs` | `number` | `undefined` | 큐에서 **대기하는 동안**의 제한 시간(ms)입니다. |
| `signal` | `AbortSignal` | `undefined` | 기본 AbortSignal입니다(대기 중에만 적용되며, 호출 단위로 덮어쓸 수 있음). |

### `RunOptions`

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `signal` | `AbortSignal` | `undefined` | 호출 단위 AbortSignal입니다(`LimiterOptions.signal`을 덮어씀). |
| `queueTimeoutMs` | `number` | `undefined` | 호출 단위 큐 대기 제한 시간(ms)입니다(`LimiterOptions.queueTimeoutMs`를 덮어씀). |

### `IdleOptions`

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `signal` | `AbortSignal` | `undefined` | idle 대기를 중단합니다. |
| `timeoutMs` | `number` | `undefined` | idle 상태가 되기까지의 제한 시간(ms)입니다. |

---

## Abort / Timeout 동작 원리

- `signal`과 `queueTimeoutMs`는 **대기 중에만** 적용됩니다(실행이 시작되기 전).
- 실행이 시작된 이후에는 리미터가 **작업 자체를 취소하지 않습니다.**
- abort/timeout된 항목은 제거 및 정리가 수행되며, **큐를 막지 않습니다.**
- `onIdle({ signal, timeoutMs })`에서도 abort/timeout을 지원합니다.

---

## 오류

오류는 `instanceof` 또는 `error.code`로 처리할 수 있습니다.

| 오류 | 코드 | 발생 조건 |
|------|------|-----------|
| `QueueOverflowError` | `ERR_ASYNC_LIMITER_QUEUE_OVERFLOW` | 큐가 가득 찬 경우(`pendingCount >= maxQueue`). |
| `QueueTimeoutError` | `ERR_ASYNC_LIMITER_QUEUE_TIMEOUT` | 큐에서 대기 시간이 제한을 초과한 경우. |
| `AbortError` | `ERR_ASYNC_LIMITER_ABORTED` | 대기 중 abort된 경우(큐 대기/idle 대기). |
| `IdleTimeoutError` | `ERR_ASYNC_LIMITER_IDLE_TIMEOUT` | `timeoutMs` 내에 idle 상태가 되지 못한 경우. |

예시:

```ts
import { Limiter, QueueTimeoutError } from '@selentia/async-limiter';

const limiter = new Limiter(3);

try {
  await limiter.run(task, { queueTimeoutMs: 300 });
} catch (err) {
  if (err instanceof QueueTimeoutError) {
    // 큐에서 너무 오래 대기함
  }
}
```

---

## 보장 사항

- 큐에 들어간 작업은 **FIFO 순서로 실행이 시작**됩니다.  
  (실행이 끝나는 순서는 달라질 수 있습니다.)
- 설정된 동시 실행 수(`limit`)는 절대 초과되지 않습니다.
- abort/timeout된 작업은 정리되며, **좀비 상태로 남지 않습니다.**
- `onIdle()`은 다음 조건을 만족할 때만 resolve됩니다.

```txt
activeCount === 0 && pendingCount === 0
```

---

## 라이선스

MIT
