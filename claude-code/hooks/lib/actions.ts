// What /talkie and the tools do, each answering the text to show.

import type { EngineInterface } from 'claude-code'
import { formatAddress, parseAddress, parseTarget, suggestName, type Target } from './address.ts'
import { formatWho } from './frame.ts'
import { startListening, stopListening } from './listener.ts'
import type { Result } from './relay.ts'
import { freshName, relayOf, renameTo, saveAuth, savePending, showStatus, type Talkie } from './talkie.ts'

export interface Outgoing { to: string, text: string, hop: number }

const SIGN_IN = 'Not signed in to clawalkietalkie. Run /talkie login <email> first.'

const why = (res: Extract<Result<unknown>, { ok: false }>): string =>
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

export async function sendMessage ($: EngineInterface, t: Talkie, out: Outgoing): Promise<string> {
  if (!t.auth) return SIGN_IN
  const target = parseTarget(out.to)
  if (!target) return `"${out.to}" is not an address (like cc:happy-dog or cx:review-bot).`
  const { name: from, instanceId } = t.identity
  const to = target.kind ? formatAddress(target.name, target.kind) : target.name
  const res = await relayOf($, t).send({ from, instanceId, to, text: out.text, hop: out.hop })
  const shown = res.ok ? res.value.to ?? formatAddress(target.name, target.kind ?? 'cc') : ''
  if (res.ok) return `Sent to ${shown}${res.value.online ? '.' : ' (offline now; delivered when it is back, within 24 h).'}`
  if (res.status === 404) return unknown($, t, target)
  if (res.status === 429) return 'Not sent: this session sent 20 messages in the last minute; wait a moment.'
  return `Not sent: ${why(res)}.`
}

async function unknown ($: EngineInterface, t: Talkie, target: Target): Promise<string> {
  const listed = await relayOf($, t).list()
  const byName = new Map(listed.ok ? listed.value.map((s) => [s.address.slice(3), s.address] as const) : [])
  const close = suggestName(target.name, [...byName.keys()])
  const hint = close ? ` Did you mean ${byName.get(close)}?` : ' /talkie who lists them.'
  return `No session is called ${formatAddress(target.name, target.kind ?? 'cc')}.${hint}`
}

export async function who ($: EngineInterface, t: Talkie): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await relayOf($, t).list()
  if (!res.ok) return `Could not list sessions: ${why(res)}.`
  return formatWho(res.value, { self: t.identity.name, now: await $.clock.now() })
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

export async function logout ($: EngineInterface, t: Talkie): Promise<string> {
  if (t.auth) {
    await relayOf($, t).unclaim(t.identity.name, t.identity.instanceId)
    await relayOf($, t).revoke()
  }
  await saveAuth($, t, undefined)
  stopListening($, t)
  return 'Signed out; this device\'s token is revoked.'
}
