// The updates loop that listen runs beside the inbox when given onUpdate: long-poll the feed from its own cursor, hand
// each update to onUpdate, read on. Updates need no ack: an onUpdate that throws is reported and the feed moves on.
// Errors back off on their own, doubling to a cap; a cursor the relay refuses reads from the oldest kept again, and
// ids already handed over are skipped, so no update is handed twice.
import { DEFAULT_BACKOFF, jitter, nextBackoff, sleep } from './backoff.ts'
import { isClawalkietalkieError, isCut } from './errors.ts'
import type { ListenOptions, UpdateHandler } from './listen.ts'
import type { UpdatesQuery } from './streams.ts'
import type { UpdatesPage } from './types.ts'

const REMEMBER = 1000

export interface UpdatesHost {
  ready: (signal: AbortSignal) => Promise<unknown>
  read: (query: UpdatesQuery) => Promise<UpdatesPage>
}

interface Feed {
  host: UpdatesHost, onUpdate: UpdateHandler, options: ListenOptions, signal: AbortSignal
  cursor?: string, handed: Set<number>, backoffMs: number
}

const isFatal = (error: unknown): boolean => isClawalkietalkieError(error) && (error.status === 401 || error.code === 'not_holder')

// invalid_cursor, or invalid_request from a relay before that code.
const isBadCursor = (error: unknown): boolean =>
  isClawalkietalkieError(error, 'invalid_cursor') || isClawalkietalkieError(error, 'invalid_request')

const report = (feed: Feed, error: unknown, delayMs: number): void =>
  feed.options.onError?.(error, { delayMs, fatal: isFatal(error) })

const hand = async (feed: Feed, page: UpdatesPage): Promise<void> => {
  for (const update of page.updates) {
    if (feed.handed.has(update.id)) continue
    feed.handed.add(update.id)
    if (feed.handed.size > REMEMBER) feed.handed.delete(feed.handed.values().next().value as number)
    try { await feed.onUpdate(update) } catch (error) { report(feed, error, 0) }
  }
  feed.cursor = page.cursor || feed.cursor
}

// undefined: a round that went well (or was cut by the network); else the error to back off on.
const round = async (feed: Feed): Promise<{ error: unknown } | undefined> => {
  const started = Date.now()
  try {
    await hand(feed, await feed.host.read({ after: feed.cursor, wait: feed.options.waitSeconds ?? 25, signal: feed.signal }))
    return undefined
  } catch (error) {
    if (isCut(error, Date.now() - started, feed.options.cutAfterMs)) return undefined
    if (feed.cursor && isBadCursor(error)) { feed.cursor = undefined; return undefined }
    return { error }
  }
}

const pause = async (feed: Feed, error: unknown): Promise<boolean> => {
  if (feed.signal.aborted) return false
  feed.backoffMs = nextBackoff(feed.backoffMs, feed.options.backoff ?? DEFAULT_BACKOFF)
  const delayMs = isFatal(error) ? 0 : jitter(feed.backoffMs, feed.options.random ?? Math.random)
  report(feed, error, delayMs)
  if (isFatal(error)) return false
  await sleep(delayMs, feed.signal)
  return !feed.signal.aborted
}

const run = async (feed: Feed): Promise<void> => {
  for (;;) {
    try { await feed.host.ready(feed.signal); break } catch (error) { if (!await pause(feed, error)) return }
  }
  while (!feed.signal.aborted) {
    const failed = await round(feed)
    if (!failed) { feed.backoffMs = 0; continue }
    if (!await pause(feed, failed.error)) return
  }
}

// Starts the feed loop under `signal`; resolves once it has ended.
export const runUpdates = (host: UpdatesHost, onUpdate: UpdateHandler, options: ListenOptions & { signal: AbortSignal }): Promise<void> =>
  run({ host, onUpdate, options, signal: options.signal, handed: new Set(), backoffMs: 0 })
