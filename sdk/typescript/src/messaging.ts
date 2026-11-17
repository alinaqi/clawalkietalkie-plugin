// Sending and following up: a send carries an Idempotency-Key and is retried on a network failure or a 5xx, so a
// retry never sends twice; replies are long-polled.
import { randomUUID } from 'node:crypto'
import { formatAddress, parseAddress } from './address.ts'
import { jitter, sleep } from './backoff.ts'
import { ClawalkietalkieError, isCut } from './errors.ts'
import { request, enc, type Wire } from './http.ts'
import type { Holder } from './files.ts'
import type { MessageStatus, MessageStatusView, ReplyWait, SendOptions, SentMessage } from './types.ts'

const ATTEMPTS = 3
const RETRY_MS = 200
const MAX_HOP = 10
const MAX_WAIT_S = 50
const SETTLED: ReadonlySet<MessageStatus> = new Set(['replied', 'refused', 'discarded', 'expired'])

const invalid = (message: string): ClawalkietalkieError => new ClawalkietalkieError(0, 'invalid_request', { message })

const bodyOf = (holder: Holder, to: string, text: string, options: SendOptions): Record<string, unknown> => {
  const target = parseAddress(to)
  if (!target) throw new ClawalkietalkieError(0, 'invalid_address', { address: to })
  const type = options.type ?? 'note'
  if (type !== 'note' && type !== 'request') throw invalid('type is note or request')
  const hop = options.hop === undefined ? {} : { hop: Math.min(MAX_HOP, Math.max(0, Math.floor(options.hop))) }
  const extra = { ...(options.about ? { about: options.about } : {}), ...(options.replyTo ? { replyTo: options.replyTo } : {}), ...(options.files?.length ? { files: options.files } : {}) }
  return { from: holder.name, instanceId: holder.instanceId, to: formatAddress(target), text, type, ...extra, ...hop }
}

export const sendMessage = async (wire: Wire, holder: Holder, out: { to: string, text: string, options: SendOptions }): Promise<SentMessage> => {
  const json = bodyOf(holder, out.to, out.text, out.options)
  const req = { method: 'POST', path: '/v1/messages', json, headers: { 'idempotency-key': randomUUID() }, signal: out.options.signal }
  for (let attempt = 1; ; attempt++) {
    try {
      return await request<SentMessage>(wire, req)
    } catch (error) {
      if (!(error instanceof ClawalkietalkieError) || !error.retryable || attempt >= ATTEMPTS) throw error
      await sleep(jitter(RETRY_MS * 2 ** (attempt - 1), Math.random), out.options.signal)
    }
  }
}

export const messageStatus = (wire: Wire, id: string): Promise<MessageStatusView> =>
  request<MessageStatusView>(wire, { method: 'GET', path: `/v1/messages/${enc(id)}` })

// cutAfterMs: a poll the network cuts after it was open this long is polled again (default 5000).
export interface WaitOptions { timeoutMs?: number, signal?: AbortSignal, cutAfterMs?: number }

type RepliesPage = { replies: ReplyWait['replies'], status: MessageStatus }

// undefined when the network cut a long poll: poll again.
const pollReplies = async (wire: Wire, id: string, wait: { seconds: number } & WaitOptions): Promise<RepliesPage | undefined> => {
  const started = Date.now()
  const query = { to: id, wait: wait.seconds }
  try {
    return await request<RepliesPage>(wire, { method: 'GET', path: '/v1/replies', query, timeoutMs: wait.seconds * 1000 + 15_000, signal: wait.signal })
  } catch (error) {
    if (isCut(error, Date.now() - started, wait.cutAfterMs)) return undefined
    throw error
  }
}

const currentReplies = async (wire: Wire, id: string): Promise<RepliesPage> => {
  const { replies, status } = await messageStatus(wire, id)
  return { replies, status }
}

// Long-polls (≤ 50 s a call) until a reply exists, none can come (refused, discarded, expired), or the timeout ends.
export const waitForReply = async (wire: Wire, id: string, options: WaitOptions = {}): Promise<ReplyWait> => {
  const end = Date.now() + (options.timeoutMs ?? 60_000)
  let last: RepliesPage | undefined
  for (;;) {
    const seconds = Math.min(MAX_WAIT_S, Math.max(0, Math.ceil((end - Date.now()) / 1000)))
    last = await pollReplies(wire, id, { ...options, seconds }) ?? last
    if (last && (last.replies.length > 0 || SETTLED.has(last.status))) return { ...last, timedOut: false }
    if (Date.now() >= end || options.signal?.aborted) return { ...(last ?? await currentReplies(wire, id)), timedOut: true }
  }
}
