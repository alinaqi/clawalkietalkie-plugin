// A message handed to a listen handler: the inbox fields, plus reply and discard.
import type { InboxMessage, SendOptions, SentMessage } from './types.ts'

export interface IncomingMessage extends InboxMessage {
  // Answers the sender in this message's thread (a note unless told otherwise), one hop deeper.
  reply: (text: string, options?: Omit<SendOptions, 'replyTo' | 'hop'>) => Promise<SentMessage>
  // Drops it as not about this agent's work: it leaves the inbox (not acked) and its sender sees `discarded`.
  discard: () => Promise<void>
}

export interface Responder {
  send: (to: string, text: string, options: SendOptions) => Promise<SentMessage>
  discard: (ids: string[]) => Promise<void>
}

export const incoming = (agent: Responder, message: InboxMessage, onDiscard: () => void): IncomingMessage => ({
  ...message,
  reply: (text, options = {}) => agent.send(message.from, text, { ...options, replyTo: message.id, hop: (message.hop ?? 0) + 1 }),
  discard: async () => {
    await agent.discard([message.id])
    onDiscard()
  }
})
