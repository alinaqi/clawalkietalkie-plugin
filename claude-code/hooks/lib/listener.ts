// The inbox loop: long-poll, deliver, ack, poll again, each step a $.clock.after timer.

import type { EngineInterface } from 'claude-code'
import { readMessage } from './hops.ts'
import type { InboxMessage } from './relay.ts'
import { relayOf, saveAuth, showStatus, type Talkie } from './talkie.ts'

const WAIT_SECONDS = 25
const GAP_MS = 250
const MAX_BACKOFF_MS = 30_000
// A reply to a reply (hop 2+) starts no turn, so two sessions cannot answer each other forever.
const MAX_PROMPT_HOP = 1

function schedule ($: EngineInterface, t: Talkie, ms: number): void {
  t.timer?.cancel()
  t.timer = $.clock.after(ms, () => { void tick($, t) })
}

function deliver ($: EngineInterface, t: Talkie, messages: readonly InboxMessage[]): void {
  for (const message of messages) {
    if (t.seen.has(message.id)) continue
    t.seen.add(message.id)
    const hop = message.hop ?? 0
    void $.ui.toast(`📻 ${message.from}: ${message.text.slice(0, 80)}`)
    if (message.delivery === 'context' || message.type === 'note') {
      t.context.push(message)
      continue
    }
    if (!t.options.autoDeliver || hop > MAX_PROMPT_HOP) {
      t.held.push(message)
      continue
    }
    void $.prompt.submit({ text: readMessage(t, message) }).catch(() => {})
  }
}

async function fail ($: EngineInterface, t: Talkie, status: number): Promise<void> {
  if (status === 401) await saveAuth($, t, undefined)
  if (status === 401 || status === 403) {
    stopListening($, t)
    if (status === 403) void $.ui.toast(`📻 another session took cc:${t.identity.name}; /talkie on takes it back`)
    return
  }
  t.backoffMs = Math.min(MAX_BACKOFF_MS, Math.max(1000, t.backoffMs * 2))
  schedule($, t, t.backoffMs)
}

async function tick ($: EngineInterface, t: Talkie): Promise<void> {
  if (!t.isListening || !t.auth) return
  const { name, instanceId } = t.identity
  const res = await relayOf($, t).inbox(name, instanceId, WAIT_SECONDS)
  if (!t.isListening) return
  if (!res.ok) return fail($, t, res.status)
  t.backoffMs = 0
  deliver($, t, res.value)
  if (res.value.length > 0) await relayOf($, t).ack(name, instanceId, res.value.map((m) => m.id))
  schedule($, t, GAP_MS)
}

export function startListening ($: EngineInterface, t: Talkie): void {
  t.isListening = true
  t.backoffMs = 0
  schedule($, t, 0)
  showStatus($, t)
}

export function stopListening ($: EngineInterface, t: Talkie): void {
  t.isListening = false
  t.timer?.cancel()
  t.timer = undefined
  showStatus($, t)
}
