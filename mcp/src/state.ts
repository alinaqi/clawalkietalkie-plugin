// What one agent holds while it runs, and the helpers every action shares.
import { randomBytes } from 'node:crypto'
import { formatAddress, generateName, type Kind } from '../../claude-code/hooks/lib/address.ts'
import { createRelay, type Fetch, type InboxMessage, type Relay, type Result } from '../../claude-code/hooks/lib/relay.ts'
import { loadAuth, saveAuth, type Auth, type Identity } from './config.ts'

export interface AgentDeps { fetch: Fetch, dir: string, serverUrl: string, cwd: string }

export interface AgentState {
  deps: AgentDeps
  auth: Auth | undefined
  kind: Kind
  identity: Identity
  pendingEmail?: string
  buffer: InboxMessage[]
  seen: Set<string>
  // The hop of the last message read from each sender, so an answer goes one deeper.
  hops: Map<string, number>
}

export const SIGN_IN = 'Not signed in to clawalkietalkie. Ask the user for their email and call the login tool.'

export const createState = (deps: AgentDeps): AgentState => ({
  deps,
  auth: loadAuth(deps.dir),
  kind: 'cx',
  identity: { name: '', instanceId: '' },
  buffer: [],
  seen: new Set(),
  hops: new Map()
})

export const relayOf = (s: AgentState): Relay =>
  createRelay(s.deps.fetch, { baseUrl: s.deps.serverUrl, token: s.auth?.token })

export const selfOf = (s: AgentState): string => formatAddress(s.identity.name, s.kind)

export const identityKey = (s: AgentState): string => `${s.kind}:${s.deps.cwd}`

export const setAuth = (s: AgentState, auth: Auth | undefined): void => {
  s.auth = auth
  saveAuth(s.deps.dir, auth)
}

export const freshName = (): string => generateName(() => randomBytes(4).readUInt32BE() / 2 ** 32)

export const why = (res: Extract<Result<unknown>, { ok: false }>): string =>
  res.status === 0 ? 'the relay is unreachable' : `the relay answered ${res.status} ${res.error}`
