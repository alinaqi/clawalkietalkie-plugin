// One agent on the network, as the MCP tools and the poll loop see it.
import type { Kind } from '../../claude-code/hooks/lib/address.ts'
import type { MessageType } from '../../claude-code/hooks/lib/relay.ts'
import { inbox, pollOnce, send, setStatus, who } from './mail.ts'
import type { Outgoing } from './mail.ts'
import { login, rename, start, status, verify } from './session.ts'
import { createState, type AgentDeps } from './state.ts'

export type { AgentDeps } from './state.ts'

// How to send: a type alone, as before, or with the id of the message it answers.
export type SendOptions = MessageType | { type?: MessageType, replyTo?: string }

const outgoing = (text: string, options: SendOptions): Outgoing =>
  typeof options === 'string' ? { text, type: options } : { text, type: options.type ?? 'note', replyTo: options.replyTo }

export const createAgent = (deps: AgentDeps) => {
  const s = createState(deps)
  let markReady = () => {}
  const ready = new Promise<void>((resolve) => { markReady = resolve })
  return {
    ready,
    start: (kind: Kind) => start(s, kind).finally(markReady),
    login: (email: string) => login(s, email),
    verify: (code: string) => verify(s, code),
    rename: (name: string) => rename(s, name),
    status: async () => status(s),
    send: (to: string, text: string, options: SendOptions = 'note') => send(s, to, outgoing(text, options)),
    inbox: () => inbox(s),
    who: () => who(s),
    setStatus: (input: Record<string, unknown>) => setStatus(s, input),
    pollOnce: (waitSeconds = 0) => pollOnce(s, waitSeconds),
    isSignedIn: () => s.auth !== undefined,
    pending: () => s.buffer.length
  }
}

export type Agent = ReturnType<typeof createAgent>
