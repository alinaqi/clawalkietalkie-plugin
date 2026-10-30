// Send one message as the key's gh: agent, then optionally wait for the answer.
import { randomUUID } from 'node:crypto'
import type { Inputs } from './inputs.ts'
import { relayClient, type RelayClient } from './relay.ts'

export interface Outputs { id: string, to: string, delivery: string, from: string, reply?: string }
export interface RunDeps { inputs: Inputs, fetch: typeof globalThis.fetch, now: () => number }

const POLL_SECONDS = 25

interface Waiting { relay: RelayClient, name: string, instanceId: string, from: string, deadline: number }

const waitForReply = async (w: Waiting, now: () => number): Promise<string | undefined> => {
  while (now() < w.deadline) {
    const wait = Math.max(1, Math.min(POLL_SECONDS, Math.ceil((w.deadline - now()) / 1000)))
    const { messages } = await w.relay.inbox(w.name, w.instanceId, wait)
    if (messages.length === 0) continue
    await w.relay.ack(w.name, w.instanceId, messages.map((m) => m.id))
    const reply = messages.find((m) => m.from === w.from)
    if (reply) return reply.text
  }
  return undefined
}

// Messages already waiting are answers to earlier runs: clear them so they are not taken as this run's reply.
const drain = async (relay: RelayClient, name: string, instanceId: string): Promise<void> => {
  const { messages } = await relay.inbox(name, instanceId, 0)
  if (messages.length > 0) await relay.ack(name, instanceId, messages.map((m) => m.id))
}

export const run = async ({ inputs, fetch, now }: RunDeps): Promise<Outputs> => {
  const relay = relayClient(inputs.server, inputs.key, fetch)
  const me = await relay.me()
  const instanceId = randomUUID()
  await relay.claim(me.name, instanceId)
  await drain(relay, me.name, instanceId)
  const sent = await relay.send({ from: me.name, instanceId, to: inputs.to, text: inputs.text })
  const outputs: Outputs = { id: sent.id, to: sent.to, delivery: sent.delivery, from: me.address }
  if (inputs.waitSeconds <= 0) return outputs
  const deadline = now() + inputs.waitSeconds * 1000
  const reply = await waitForReply({ relay, name: me.name, instanceId, from: sent.to, deadline }, now)
  return reply === undefined ? outputs : { ...outputs, reply }
}
