// /talkie approvals, approve and deny. Only the person decides: these are slash commands, never tools,
// so a message cannot talk the model into letting another message through.

import type { EngineInterface } from 'claude-code'
import { SIGN_IN, why } from './actions.ts'
import { boardUrl, type Approval } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

const heldLine = (a: Approval): string =>
  `${a.id} · from ${a.from} (${a.fromEmail}) to ${a.to}:\n  ${a.text.replaceAll('\n', '\n  ')}`

export async function approvals ($: EngineInterface, t: Talkie): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await relayOf($, t).approvals()
  if (!res.ok) return `Could not list held messages: ${why(res)}.`
  if (res.value.length === 0) return 'No messages wait for your approval.'
  const usage = '/talkie approve <id> delivers one as a prompt; /talkie deny <id> drops it.'
  return [...res.value.map(heldLine), usage, `Or decide on the board: ${boardUrl(t.options.serverUrl)}`].join('\n\n')
}

export interface Decision { id: string, decision: 'allow' | 'deny' }

export async function decide ($: EngineInterface, t: Talkie, choice: Decision): Promise<string> {
  if (!t.auth) return SIGN_IN
  const { id, decision } = choice
  const res = await relayOf($, t).decide(id, decision)
  if (!res.ok) return res.status === 404 ? `No held message is called ${id}; /talkie approvals lists them.` : `Not decided: ${why(res)}.`
  return decision === 'allow' ? `Allowed ${id}; it is delivered as a prompt.` : `Denied ${id}; it is dropped.`
}
