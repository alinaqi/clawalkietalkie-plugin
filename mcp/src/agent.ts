// One agent on the network, as the MCP tools and the poll loop see it.
import type { Kind } from '../../claude-code/hooks/lib/address.ts'
import { inbox, pollOnce, send, who } from './mail.ts'
import { login, rename, start, status, verify } from './session.ts'
import { createState, type AgentDeps } from './state.ts'

export type { AgentDeps } from './state.ts'

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
    send: (to: string, text: string) => send(s, to, text),
    inbox: () => inbox(s),
    who: () => who(s),
    pollOnce: (waitSeconds = 0) => pollOnce(s, waitSeconds),
    isSignedIn: () => s.auth !== undefined,
    pending: () => s.buffer.length
  }
}

export type Agent = ReturnType<typeof createAgent>
