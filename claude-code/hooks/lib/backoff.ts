// Reconnect waits: doubling from 1 s to a cap, each spread ±20% so many clients do not retry in step.
// The MCP server bundles this file too.

const FIRST_MS = 1000
const SPREAD = 0.2

export const nextBackoff = (previousMs: number, maxMs: number): number =>
  Math.min(maxMs, Math.max(FIRST_MS, previousMs * 2))

// `random` returns a float in [0, 1), like Math.random; the wait lands in [0.8 ms, 1.2 ms).
export const jitter = (ms: number, random: () => number): number =>
  Math.floor(ms * (1 - SPREAD + 2 * SPREAD * random()))
