// /talkie <subcommand>.

import type { EngineInterface } from 'claude-code'
import { formatAddress } from './address.ts'
import { connect, login, logout, rename, sendMessage, verify, who } from './actions.ts'
import { frameIncoming, parseSendArgs } from './frame.ts'
import { stopListening } from './listener.ts'
import type { Talkie } from './talkie.ts'

export const HELP = [
  'clawalkietalkie: message your other Claude Code sessions.',
  '',
  '/talkie login <email>         email a sign-in code',
  '/talkie verify <code>         finish signing in',
  '/talkie who                   list your sessions',
  '/talkie send <cc:name> <text> send a message',
  '/talkie name <name>           rename this session',
  '/talkie inbox                 show messages held while auto-delivery is off',
  '/talkie on | off              start or stop listening',
  '/talkie status                show the address and the relay',
  '/talkie logout                sign out and revoke this device'
].join('\n')

const status = (t: Talkie): string => [
  `Address: ${formatAddress(t.identity.name)}`,
  `Account: ${t.auth?.email ?? 'not signed in'}`,
  `Relay: ${t.options.serverUrl}`,
  `Listening: ${t.isListening ? 'yes' : 'no'} · auto-deliver: ${t.options.autoDeliver ? 'on' : 'off'}`
].join('\n')

const inbox = (t: Talkie): string => {
  const held = t.held.splice(0)
  return held.length === 0 ? 'No held messages.' : held.map((m) => frameIncoming(m, t.identity.name)).join('\n\n')
}

async function turnOn ($: EngineInterface, t: Talkie): Promise<string> {
  if (!t.auth) return 'Not signed in. Run /talkie login <email> first.'
  const text = await connect($, t)
  return t.isListening ? `Listening. ${text}` : text
}

function turnOff ($: EngineInterface, t: Talkie): string {
  stopListening($, t)
  return 'Listening stopped; messages wait on the relay for up to 24 h.'
}

function send ($: EngineInterface, t: Talkie, rest: string): Promise<string> | string {
  const parsed = parseSendArgs(rest)
  return parsed ? sendMessage($, t, { ...parsed, hop: 0 }) : 'Usage: /talkie send <cc:name> <text>'
}

export async function runTalkie ($: EngineInterface, t: Talkie, args: string): Promise<string> {
  const [word = '', ...words] = args.trim().split(/\s+/)
  const rest = words.join(' ')
  switch (word.toLowerCase()) {
    case 'login': return rest ? login($, t, rest) : 'Usage: /talkie login <email>'
    case 'verify': return rest ? verify($, t, rest) : 'Usage: /talkie verify <code>'
    case 'logout': return logout($, t)
    case 'who': return who($, t)
    case 'name': return rename($, t, rest)
    case 'send': return send($, t, args.trim().slice(word.length))
    case 'inbox': return inbox(t)
    case 'status': return status(t)
    case 'on': return turnOn($, t)
    case 'off': return turnOff($, t)
    default: return HELP
  }
}
