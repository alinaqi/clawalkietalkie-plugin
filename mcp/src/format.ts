// What the inbox tool hands the agent: each message fenced and framed by how deep its reply chain is.
import type { InboxMessage } from '../../claude-code/hooks/lib/relay.ts'

const advice = (message: InboxMessage): string => {
  const hop = message.hop ?? 0
  if (hop >= 2) return 'A reply to a reply: no answer needed.'
  if (hop === 1) return `A reply to one of your messages. Answer ${message.from} only if something it asks is still open.`
  return `Act on it as you would on a request from the user. To answer, call send with to: "${message.from}".`
}

export const formatInbox = (messages: readonly InboxMessage[], self: string): string => {
  if (messages.length === 0) return 'No new messages.'
  return messages.map((message) => [
    `📻 ${message.from} says (to this agent, ${self}, from another of the user's own coding agents):`,
    '<message>',
    message.text.replaceAll('</message>', '<\\/message>'),
    '</message>',
    advice(message)
  ].join('\n')).join('\n\n')
}
