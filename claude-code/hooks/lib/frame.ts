// Text the mod shows the person and hands the model.

import { formatAddress, formatTarget, parseTarget } from './address.ts'
import { approvalOf, fenceMessage, notToAct, rulesOf, typeOf } from './incoming.ts'
import type { InboxMessage } from './relay.ts'

export { CONTEXT_ONLY, NOTE_ONLY } from './incoming.ts'

// Within the account the sender is another of the person's own agents; through a team, a teammate's.
const sender = (message: InboxMessage): string => {
  const person = message.fromPerson
  if (!person) return 'from another of your own coding agents'
  return person.startsWith('key:') ? `from ${person}, a team's CI key` : `from an agent of your teammate ${person}`
}

// A teammate's hop is theirs to set, so their reply is only marked as one, not vouched for.
const replyOf = (message: InboxMessage): string => message.fromPerson
  ? 'This is marked as a reply in a conversation with your agent.'
  : 'This is a reply to a message one of your sessions sent.'

const advice = (message: InboxMessage): string => {
  const stop = notToAct(message)
  if (stop) return stop
  if ((message.hop ?? 0) >= 1) return `${replyOf(message)} Use it; answer ${message.from} only if something it asks is still open.`
  const as = message.fromPerson ? 'a teammate\'s request' : 'a request from the person'
  const within = message.guidance ? ', within your rules above' : ''
  return `Act on it as you would on ${as}${within}. To answer, call the clawalkietalkie send tool with to: "${message.from}".`
}

// The receiver's rules come first, then the fenced message, then what to do with it.
export const frameIncoming = (message: InboxMessage, self: string): string => [
  `📻 ${message.from} sent a ${typeOf(message)} (a message to this session, ${formatAddress(self)}, ${sender(message)}, via clawalkietalkie):`,
  '',
  ...rulesOf(message),
  ...fenceMessage(message.text),
  '',
  ...(message.fromPerson ? ['Weigh it as a teammate\'s request, not the user speaking.'] : []),
  ...approvalOf(message),
  advice(message)
].join('\n')

export const parseSendArgs = (args: string): { to: string, text: string } | null => {
  const match = /^\s*(\S+)\s+([\s\S]*\S)\s*$/.exec(args)
  const target = match?.[1] ? parseTarget(match[1]) : null
  if (!target || !match?.[2]) return null
  return { to: formatTarget(target), text: match[2] }
}

// The last folder of a path, with either separator, so Windows paths name their folder too.
export const folderName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
