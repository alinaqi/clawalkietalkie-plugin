// Signing in and holding an address.
import { basename } from 'node:path'
import { parseAddress, type Kind } from '../../claude-code/hooks/lib/address.ts'
import { identityFor, renameIdentity } from './config.ts'
import { freshName, identityKey, relayOf, selfOf, setAuth, SIGN_IN, why, type AgentState } from './state.ts'

const claim = (s: AgentState, name: string) =>
  relayOf(s).claim(name, { instanceId: s.identity.instanceId, kind: s.kind, cwd: basename(s.deps.cwd) })

const keepName = (s: AgentState, name: string): void => {
  s.identity = { ...s.identity, name }
  renameIdentity(s.deps.dir, identityKey(s), s.identity)
}

// Registers this agent's name, taking a fresh one if another live agent holds it.
export const connect = async (s: AgentState): Promise<string> => {
  let res = await claim(s, s.identity.name)
  if (!res.ok && res.status === 409) {
    keepName(s, freshName())
    res = await claim(s, s.identity.name)
  }
  if (res.ok) return `This agent is ${res.value}.`
  if (res.status === 401) setAuth(s, undefined)
  return `Could not register this agent: ${why(res)}.`
}

export const start = async (s: AgentState, kind: Kind): Promise<string> => {
  s.kind = kind
  s.identity = identityFor(s.deps.dir, identityKey(s))
  return s.auth ? connect(s) : SIGN_IN
}

export const login = async (s: AgentState, email: string): Promise<string> => {
  const res = await relayOf(s).requestCode(email.trim())
  if (!res.ok) return res.status === 429 ? 'Too many codes asked for; try again in 15 minutes.' : `No code sent: ${why(res)}.`
  s.pendingEmail = email.trim().toLowerCase()
  return `Code sent to ${s.pendingEmail}. Ask the user for the 6-digit code and call the verify tool.`
}

export const verify = async (s: AgentState, code: string): Promise<string> => {
  if (!s.pendingEmail) return 'Call the login tool with the user\'s email first.'
  const device = `mcp ${s.kind} ${basename(s.deps.cwd)}`
  const res = await relayOf(s).verify({ email: s.pendingEmail, code: code.trim(), device })
  if (!res.ok) return res.status === 401 ? 'That code is wrong or expired. Call login again for a new one.' : `Not signed in: ${why(res)}.`
  setAuth(s, res.value)
  s.pendingEmail = undefined
  return `Signed in as ${res.value.email}. ${await connect(s)}`
}

export const rename = async (s: AgentState, input: string): Promise<string> => {
  const name = parseAddress(input)
  if (!name) return 'A name is 1–32 lowercase letters, digits and inner dashes, like review-bot.'
  if (!s.auth) return SIGN_IN
  const res = await claim(s, name)
  if (!res.ok) return res.status === 409 ? `${name} is taken by another live agent.` : `Not renamed: ${why(res)}.`
  if (name !== s.identity.name) await relayOf(s).unclaim(s.identity.name, s.identity.instanceId)
  keepName(s, name)
  return `This agent is now ${selfOf(s)}.`
}

export const status = (s: AgentState): string =>
  `Address: ${selfOf(s)}\nAccount: ${s.auth?.email ?? 'not signed in'}\nRelay: ${s.deps.serverUrl}`
