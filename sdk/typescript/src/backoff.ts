// Waits between retries: doubling from a floor to a cap, each spread ±20% so many clients do not retry in step.

export interface Backoff { minMs: number, maxMs: number }

export const DEFAULT_BACKOFF: Backoff = { minMs: 1000, maxMs: 30_000 }

export const nextBackoff = (previousMs: number, limits: Backoff): number =>
  Math.min(limits.maxMs, Math.max(limits.minMs, previousMs * 2))

// `random` returns a float in [0, 1), like Math.random; 0.5 gives the wait exactly.
export const jitter = (ms: number, random: () => number): number => Math.round(ms * (0.8 + 0.4 * random()))

// Resolves after `ms`, or at once when the signal aborts.
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted) return resolve()
  const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, ms)
  signal?.addEventListener('abort', done, { once: true })
})
