// The fake relay's inbox and outbox, to the reply-threading contract: an inbox read with a cursor
// (`after`), messages removed only by ack, sends that may answer a received message (replyTo) and
// that an Idempotency-Key makes safe to retry.

import { INVALID, type Body, type Reply } from './fake-routes.ts'

export interface Stored { id: string, from: string, thread?: string, [key: string]: unknown }

const CURSOR = /^c(\d+)$/

const readPage = (entries: ReadonlyArray<{ seq: number, message: Stored }>, after: string | null): Reply => {
  const match = after === null ? null : CURSOR.exec(after)
  if (after !== null && !match) return { status: 400, body: { error: 'invalid_cursor' } }
  const from = match ? Number(match[1]) : 0
  const page = entries.filter((e) => e.seq > from)
  const last = page.at(-1)?.seq
  const cursor = last === undefined ? after : `c${last}`
  return { status: 200, body: { messages: page.map((e) => e.message), cursor } }
}

// An address the sender typed names the original sender when it is that sender, with or without its kind.
const sameAddress = (to: unknown, from: string): boolean =>
  typeof to === 'string' && (to === from || from.endsWith(`:${to}`))

const accepted = (body: Body, original: Stored | undefined, id: string): Reply => {
  const type = body?.type ?? 'note'
  const delivery = type === 'note' ? 'context' : 'prompt'
  const thread = original ? original.thread ?? original.id : id
  const to = typeof body?.to === 'string' ? (body.to.includes(':') ? body.to : `cc:${body.to}`) : undefined
  return { status: 201, body: { id, online: true, to, delivery, type, status: 'queued', thread } }
}

export const createFakeInbox = () => {
  const entries: Array<{ seq: number, message: Stored }> = []
  const received = new Map<string, Stored>()
  const sentByKey = new Map<string, Reply>()
  let seq = 0
  let sends = 0

  const push = (message: Stored): void => {
    entries.push({ seq: ++seq, message })
    received.set(message.id, message)
  }

  const ack = (ids: unknown): Reply => {
    const gone = new Set(Array.isArray(ids) ? ids : [])
    for (let i = entries.length - 1; i >= 0; i--) if (gone.has(entries[i]!.message.id)) entries.splice(i, 1)
    return { status: 204 }
  }

  const send = (body: Body, key: string | undefined): Reply => {
    const kept = key ? sentByKey.get(key) : undefined
    if (kept) return kept
    const type = body?.type ?? 'note'
    if (type !== 'note' && type !== 'request') return INVALID
    const original = body?.replyTo === undefined ? undefined : received.get(String(body.replyTo))
    if (body?.replyTo !== undefined && (!original || !sameAddress(body.to, original.from))) {
      return { status: 400, body: { error: 'invalid_reply_to' } }
    }
    const reply = accepted(body, original, sends++ === 0 ? 'm-new' : `m-new-${sends}`)
    if (key) sentByKey.set(key, reply)
    return reply
  }

  return { push, ack, send, read: (after: string | null) => readPage(entries, after), size: () => entries.length, nextId: () => `m${seq + 1}` }
}
