// The listen loop: long-poll the inbox from the cursor, hand each message to the handler, ack it once the handler
// resolved. A handler that throws leaves its message unacked and the cursor is dropped, so the relay hands it over
// again (after a backoff); errors back off, doubling to a cap; stop() aborts the poll and resolves when the loop ends.
import { DEFAULT_BACKOFF, jitter, nextBackoff, sleep, type Backoff } from './backoff.ts'
import { isClawalkietalkieError, isCut } from './errors.ts'
import type { InboxMessage, InboxPage } from './types.ts'
import type { IncomingMessage } from './message.ts'

export type Handler = (message: IncomingMessage) => unknown | Promise<unknown>

// fatal: the loop stopped (the token is no longer valid, or another instance took the name).
export interface ListenErrorInfo { delayMs: number, message?: InboxMessage, fatal: boolean }

// cutAfterMs: a poll the network cuts after it was open this long counts as an empty answer (default 5000), since
// proxies and servers may end long-polls early.
export interface ListenOptions {
  waitSeconds?: number, backoff?: Backoff, random?: () => number, signal?: AbortSignal, cutAfterMs?: number
  onError?: (error: unknown, info: ListenErrorInfo) => void
}

// What the loop needs of an agent.
export interface Listener {
  ready: (signal: AbortSignal) => Promise<unknown>
  poll: (query: { after?: string, wait: number, signal: AbortSignal }) => Promise<InboxPage>
  ack: (ids: string[]) => Promise<void>
  wrap: (message: InboxMessage, onDiscard: () => void) => IncomingMessage
}

interface Failure { error: unknown, message?: InboxMessage }
const REMEMBER = 1000

const isFatal = (error: unknown): boolean => isClawalkietalkieError(error) && (error.status === 401 || error.code === 'not_holder')

interface Loop {
  host: Listener, handler: Handler, options: ListenOptions, signal: AbortSignal
  cursor?: string, handled: Set<string>, unacked: string[], backoffMs: number
}

const remember = (loop: Loop, id: string): void => {
  loop.handled.add(id)
  if (loop.handled.size > REMEMBER) loop.handled.delete(loop.handled.values().next().value as string)
}

// Already handled (its ack failed and it came back): acked again, never handled twice.
const handle = async (loop: Loop, message: InboxMessage): Promise<Failure | undefined> => {
  if (loop.handled.has(message.id)) { loop.unacked.push(message.id); return undefined }
  let discarded = false
  try { await loop.handler(loop.host.wrap(message, () => { discarded = true })) } catch (error) { return { error, message } }
  remember(loop, message.id)
  if (!discarded) loop.unacked.push(message.id)
  return undefined
}

const handlePage = async (loop: Loop, page: InboxPage): Promise<Failure | undefined> => {
  for (const message of page.messages) {
    const failed = await handle(loop, message)
    if (failed) return failed
  }
  return undefined
}

const flushAcks = async (loop: Loop): Promise<Failure | undefined> => {
  if (loop.unacked.length === 0) return undefined
  const ids = [...new Set(loop.unacked)]
  try { await loop.host.ack(ids) } catch (error) { return { error } }
  loop.unacked = loop.unacked.filter((id) => !ids.includes(id))
  return undefined
}

const read = async (loop: Loop): Promise<InboxPage | Failure> => {
  const started = Date.now()
  try {
    return await loop.host.poll({ after: loop.cursor, wait: loop.options.waitSeconds ?? 25, signal: loop.signal })
  } catch (error) {
    if (isCut(error, Date.now() - started, loop.options.cutAfterMs)) return { messages: [], cursor: loop.cursor ?? null }
    // A cursor the relay no longer takes: read the whole inbox again.
    if (loop.cursor && isClawalkietalkieError(error, 'invalid_request')) { loop.cursor = undefined; return { messages: [], cursor: null } }
    return { error }
  }
}

const round = async (loop: Loop): Promise<Failure | undefined> => {
  const page = await read(loop)
  if ('error' in page) return page
  const failed = await handlePage(loop, page)
  loop.cursor = failed ? undefined : page.cursor ?? undefined
  return failed ?? await flushAcks(loop)
}

// Reports the failure and waits out the backoff; false when the loop should end.
const pause = async (loop: Loop, failure: Failure): Promise<boolean> => {
  if (loop.signal.aborted) return false
  const fatal = isFatal(failure.error)
  loop.backoffMs = nextBackoff(loop.backoffMs, loop.options.backoff ?? DEFAULT_BACKOFF)
  const delayMs = fatal ? 0 : jitter(loop.backoffMs, loop.options.random ?? Math.random)
  loop.options.onError?.(failure.error, { delayMs, message: failure.message, fatal })
  if (fatal) return false
  await sleep(delayMs, loop.signal)
  return !loop.signal.aborted
}

const begin = async (loop: Loop): Promise<boolean> => {
  for (;;) {
    try { await loop.host.ready(loop.signal); return true } catch (error) { if (!await pause(loop, { error })) return false }
  }
}

const run = async (loop: Loop): Promise<void> => {
  if (!await begin(loop)) return
  while (!loop.signal.aborted) {
    const failed = await round(loop)
    if (!failed) { loop.backoffMs = 0; continue }
    if (!await pause(loop, failed)) return
  }
}

// Starts the loop; the answer stops it and resolves once the handler running (if any) has finished.
export const createLoop = (host: Listener, handler: Handler, options: ListenOptions): () => Promise<void> => {
  const control = new AbortController()
  options.signal?.addEventListener('abort', () => control.abort(), { once: true })
  const done = run({ host, handler, options, signal: control.signal, handled: new Set(), unacked: [], backoffMs: 0 })
  return async () => { control.abort(); await done }
}
