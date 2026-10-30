// The per-session state the hooks share, and the stored identity behind it.
// The engine follows $ only into function declarations, so every helper here takes it first.

import type { EngineInterface } from 'claude-code'
import { formatAddress, generateName } from './address.ts'
import { createRelay, type InboxMessage, type Relay } from './relay.ts'

export interface Auth { token: string, email: string }
export interface Identity { name: string, instanceId: string }
export interface Options { serverUrl: string, autoDeliver: boolean }

export interface Talkie {
  options: Options
  sessionId: string
  cwd: string
  auth: Auth | undefined
  identity: Identity
  isListening: boolean
  pendingEmail?: string
  held: InboxMessage[]
  seen: Set<string>
  timer?: { cancel: () => void }
  backoffMs: number
  // The hop a send from the current turn goes at: 0 after the person types, one past what it answers.
  turnHop: number
}

const AUTH_KEY = 'auth'
const PENDING_KEY = 'pendingEmail'
const identityKey = (sessionId: string) => `session:${sessionId}`

const randomFloat = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32

const newInstanceId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const freshName = (): string => generateName(randomFloat)

export async function loadTalkie ($: EngineInterface, options: Options, cwd: string): Promise<Talkie> {
  const sessionId = await $.session.id()
  const stored = await $.store.get(identityKey(sessionId)) as Identity | undefined
  const identity = stored ?? { name: freshName(), instanceId: newInstanceId() }
  if (!stored) await $.store.set(identityKey(sessionId), identity)
  const auth = await $.store.get(AUTH_KEY) as Auth | undefined
  const pendingEmail = await $.store.get(PENDING_KEY) as string | undefined
  return { options, sessionId, cwd, auth, identity, pendingEmail, isListening: false, held: [], seen: new Set(), backoffMs: 0, turnHop: 0 }
}

export async function saveAuth ($: EngineInterface, t: Talkie, auth: Auth | undefined): Promise<void> {
  t.auth = auth
  if (auth) await $.store.set(AUTH_KEY, auth)
  else await $.store.delete(AUTH_KEY)
}

// The email a code was sent to, kept until verify so a restart in between loses nothing.
export async function savePending ($: EngineInterface, t: Talkie, email: string | undefined): Promise<void> {
  t.pendingEmail = email
  if (email) await $.store.set(PENDING_KEY, email)
  else await $.store.delete(PENDING_KEY)
}

export async function renameTo ($: EngineInterface, t: Talkie, name: string): Promise<void> {
  t.identity = { ...t.identity, name }
  await $.store.set(identityKey(t.sessionId), t.identity)
}

export function relayOf ($: EngineInterface, t: Talkie): Relay {
  const fetch = (url: string, init?: Parameters<EngineInterface['http']['fetch']>[1]) => $.http.fetch(url, init)
  return createRelay(fetch, { baseUrl: t.options.serverUrl, token: t.auth?.token })
}

export function showStatus ($: EngineInterface, t: Talkie): void {
  const address = formatAddress(t.identity.name)
  const text = !t.auth ? '📻 /talkie login' : t.isListening ? `📻 ${address}` : `📻 ${address} (off)`
  void $.ui.status(text)
}
