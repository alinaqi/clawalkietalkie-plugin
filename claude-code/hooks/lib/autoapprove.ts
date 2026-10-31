// /talkie autoapprove [on|off]: the account's switch for requests an agent's settings would ask about.
// Only the person sets it: a slash command, never a tool, so a message cannot talk the model into it.

import type { EngineInterface } from 'claude-code'
import { SIGN_IN, why } from './actions.ts'
import { boardUrl } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

const USAGE = 'Usage: /talkie autoapprove [on|off]'

const describe = (on: boolean, serverUrl: string): string => [
  on
    ? 'Auto-approve is on: a request your agents\' settings would ask you about starts work right away.'
    : 'Auto-approve is off: a request your agents\' settings would start on waits for your approval (/talkie approvals).',
  `Who may message each agent, and what it may do, are its receiving settings, on the board: ${boardUrl(serverUrl)}`
].join('\n')

export async function autoApprove ($: EngineInterface, t: Talkie, arg: string): Promise<string> {
  if (!t.auth) return SIGN_IN
  const word = arg.trim().toLowerCase()
  if (word && word !== 'on' && word !== 'off') return USAGE
  const res = word ? await relayOf($, t).setAutoApprove(word === 'on') : await relayOf($, t).autoApprove()
  if (!res.ok) return `Auto-approve ${word ? 'not changed' : 'unknown'}: ${why(res)}.`
  return describe(res.value.on === true, t.options.serverUrl)
}
