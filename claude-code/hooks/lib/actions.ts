// What /talkie and the tools do, each answering the text to show.

import type { EngineInterface } from 'claude-code'
import { formatAddress, parseAddress } from './address.ts'
import { startListening, stopListening } from './listener.ts'
import type { Result } from './relay.ts'
import { describeWho, parseStatus, statusText } from './who.ts'
import { freshName, relayOf, renameTo, saveAuth, savePending, showStatus, type Talkie } from './talkie.ts'

export const SIGN_IN = 'Not signed in to clawalkietalkie. Run /talkie login <email> first.'

export const why = (res: Extract<Result<unknown>, { ok: false }>): string =>
  res.status === 0 ? 'the relay server is unreachable' : `the relay answered ${res.status} ${res.error}`

function claim ($: EngineInterface, t: Talkie, name: string) {
  return relayOf($, t).claim(name, { instanceId: t.identity.instanceId, cwd: t.cwd || undefined })
}

// Claims this session's name (a fresh one if another live session holds it) and listens.
export async function connect ($: EngineInterface, t: Talkie): Promise<string> {
  let res = await claim($, t, t.identity.name)
  if (!res.ok && res.status === 409) {
    await renameTo($, t, freshName())
    res = await claim($, t, t.identity.name)
  }
  if (!res.ok) {
    if (res.status === 401) await saveAuth($, t, undefined)
    showStatus($, t)
    return `Could not register this session: ${why(res)}.`
  }
  startListening($, t)
  return `This session is ${res.value}.`
}

export async function who ($: EngineInterface, t: Talkie): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await describeWho(relayOf($, t), { self: t.identity.name, now: await $.clock.now() })
  return res.ok ? res.value : `Could not list sessions: ${why(res)}.`
}

// What this session's agent is doing, for who and the board.
export async function setStatus ($: EngineInterface, t: Talkie, input: Record<string, unknown>): Promise<string> {
  if (!t.auth) return SIGN_IN
  const status = parseStatus(input)
  if (typeof status === 'string') return `Status not set: ${status}`
  const res = await relayOf($, t).setStatus(t.identity.name, { instanceId: t.identity.instanceId, ...status })
  return res.ok ? `Status set: ${statusText(status)}.` : `Status not set: ${why(res)}.`
}

export async function rename ($: EngineInterface, t: Talkie, input: string): Promise<string> {
  const name = parseAddress(input)
  if (!name) return 'A name is 1–32 lowercase letters, digits and inner dashes, like happy-dog.'
  if (!t.auth) return SIGN_IN
  const res = await claim($, t, name)
  if (!res.ok) return res.status === 409 ? `${formatAddress(name)} is taken by another live session.` : `Not renamed: ${why(res)}.`
  const old = t.identity.name
  if (old !== name) await relayOf($, t).unclaim(old, t.identity.instanceId)
  await renameTo($, t, name)
  startListening($, t)
  return `This session is now ${formatAddress(name)}.`
}

export async function login ($: EngineInterface, t: Talkie, email: string): Promise<string> {
  const res = await relayOf($, t).requestCode(email.trim())
  if (!res.ok) return res.status === 429 ? 'Too many codes asked for; try again in 15 minutes.' : `No code sent: ${why(res)}.`
  await savePending($, t, email.trim().toLowerCase())
  return `Code sent to ${t.pendingEmail}. Run /talkie verify <code>.`
}

export async function verify ($: EngineInterface, t: Talkie, code: string): Promise<string> {
  if (!t.pendingEmail) return 'Run /talkie login <email> first.'
  const device = `claude-code ${t.cwd}`.trim()
  const res = await relayOf($, t).verify({ email: t.pendingEmail, code: code.trim(), device })
  if (!res.ok) return res.status === 401 ? 'That code is wrong or expired. Run /talkie login again for a new one.' : `Not signed in: ${why(res)}.`
  await saveAuth($, t, res.value)
  await savePending($, t, undefined)
  return `Signed in as ${res.value.email}. ${await connect($, t)}`
}

// Signs out here even when the relay cannot revoke the token, and says which happened.
export async function logout ($: EngineInterface, t: Talkie): Promise<string> {
  const res = t.auth ? await revoke($, t) : { ok: true as const, value: {} }
  await saveAuth($, t, undefined)
  stopListening($, t)
  if (res.ok) return 'Signed out; this device\'s token is revoked.'
  return `Signed out on this device, but its token could not be revoked: ${why(res)}. ` +
    'It is deleted here, and stays valid on the relay until it expires.'
}

async function revoke ($: EngineInterface, t: Talkie): Promise<Result<object>> {
  await relayOf($, t).unclaim(t.identity.name, t.identity.instanceId)
  return relayOf($, t).revoke()
}
