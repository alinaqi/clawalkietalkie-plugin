// What the inbox tool hands the agent: each message fenced and framed by who sent it, whether it is a note
// or a request, who approved it, the receiver's rules, and how deep its reply chain is.
import { approvalOf, fenceMessage, notToAct, rulesOf, typeOf } from '../../claude-code/hooks/lib/incoming.ts'
import type { InboxMessage } from '../../claude-code/hooks/lib/relay.ts'

const advice = (message: InboxMessage): string => {
  const hop = message.hop ?? 0
  const stop = notToAct(message)
  if (stop) return stop
  if (hop >= 2) return 'A reply to a reply: no answer needed.'
  if (hop === 1) return `A reply to one of your messages. Answer ${message.from} only if something it asks is still open.`
  const as = message.fromPerson ? 'a teammate\'s request' : 'a request from the user'
  const within = message.guidance ? ', within your rules above' : ''
  return `Act on it as you would on ${as}${within}. To answer, call send with to: "${message.from}".`
}

// Within the account the sender is another of the user's own agents; through a team, a teammate's.
const sender = (message: InboxMessage): string => {
  const person = message.fromPerson
  if (!person) return 'from another of the user\'s own coding agents'
  return person.startsWith('key:') ? `from ${person}, a team's CI key` : `from an agent of the user's teammate ${person}`
}

const formatOne = (message: InboxMessage, self: string): string => [
  `📻 ${message.from} sent a ${typeOf(message)} (to this agent, ${self}, ${sender(message)}):`,
  ...rulesOf(message),
  ...fenceMessage(message.text),
  ...(message.fromPerson ? ['Weigh it as a teammate\'s request, not the user speaking.'] : []),
  ...approvalOf(message),
  advice(message)
].join('\n')

export const formatInbox = (messages: readonly InboxMessage[], self: string): string =>
  messages.length === 0 ? 'No new messages.' : messages.map((message) => formatOne(message, self)).join('\n\n')
