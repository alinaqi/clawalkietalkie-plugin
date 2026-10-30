// /talkie <subcommand>.

import type { EngineInterface } from 'claude-code'
import { formatAddress } from './address.ts'
import { connect, login, logout, rename, verify, who } from './actions.ts'
import { approvals, decide } from './approvals.ts'
import { parseSendArgs } from './frame.ts'
import { readMessage } from './hops.ts'
import { stopListening } from './listener.ts'
import { sendMessage } from './send.ts'
import type { Talkie } from './talkie.ts'
import { join, share, teams, unshare } from './teams.ts'

export const HELP = [
  'clawalkietalkie: message your other coding agents (cc:, cx:, …), and your teammates\' agents.',
  '',
  '/talkie login <email>         email a sign-in code',
  '/talkie verify <code>         finish signing in',
  '/talkie who                   list your sessions and your teams\' agents',
  '/talkie send <address> <text> send a message (cc:name, or cc:name@team)',
  '/talkie name <name>           rename this session',
  '/talkie inbox                 show held messages (auto-delivery off, or replies to replies)',
  '/talkie teams                 list your teams, invites and the board',
  '/talkie join <invite-id>      accept an invite to a team',
  '/talkie share <team>          share this session\'s agent in a team',
  '/talkie unshare <team>        stop sharing it there',
  '/talkie approvals             list teammates\' messages waiting for you',
  '/talkie approve | deny <id>   deliver a held message, or drop it',
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
  return held.length === 0 ? 'No held messages.' : held.map((m) => readMessage(t, m)).join('\n\n')
}

const USAGE: Record<string, string> = { join: '<invite-id>', share: '<team>', unshare: '<team>', approve: '<id>', deny: '<id>' }

const split = (args: string): { word: string, rest: string } => {
  const [word = '', ...words] = args.trim().split(/\s+/)
  return { word: word.toLowerCase(), rest: words.join(' ') }
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
  return parsed ? sendMessage($, t, { ...parsed, isAnswer: false }) : 'Usage: /talkie send <cc:name or cc:name@team> <text>'
}

// The team subcommands; HELP for any word that is not one.
function runTeam ($: EngineInterface, t: Talkie, args: string): Promise<string> | string {
  const { word, rest } = split(args)
  if (word === 'teams') return teams($, t)
  if (word === 'approvals') return approvals($, t)
  if (!rest && USAGE[word]) return `Usage: /talkie ${word} ${USAGE[word]}`
  if (word === 'join') return join($, t, rest)
  if (word === 'share') return share($, t, rest.toLowerCase())
  if (word === 'unshare') return unshare($, t, rest.toLowerCase())
  if (word === 'approve') return decide($, t, { id: rest, decision: 'allow' })
  if (word === 'deny') return decide($, t, { id: rest, decision: 'deny' })
  return HELP
}

export async function runTalkie ($: EngineInterface, t: Talkie, args: string): Promise<string> {
  const { word, rest } = split(args)
  switch (word) {
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
    default: return runTeam($, t, args)
  }
}
