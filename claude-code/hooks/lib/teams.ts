// /talkie teams, join, share and unshare: the person's teams and this session's place in them.

import type { EngineInterface } from 'claude-code'
import { SIGN_IN, why } from './actions.ts'
import { boardUrl, type Invite, type TeamInfo } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

const teamLine = (team: TeamInfo): string => `  ${team.slug} (${team.name}) · ${team.role}`

const inviteLine = (invite: Invite): string =>
  `  ${invite.id} · ${invite.name} (${invite.team}) · ${invite.role} · from ${invite.invitedBy} — /talkie join ${invite.id}`

export async function teams ($: EngineInterface, t: Talkie): Promise<string> {
  if (!t.auth) return SIGN_IN
  const [listed, invites] = await Promise.all([relayOf($, t).teams(), relayOf($, t).invites()])
  if (!listed.ok) return `Could not list teams: ${why(listed)}.`
  const pending = invites.ok ? invites.value : []
  return [
    listed.value.length > 0 ? ['Teams:', ...listed.value.map(teamLine)].join('\n') : 'You are in no team yet.',
    ...(pending.length > 0 ? [['Invites:', ...pending.map(inviteLine)].join('\n')] : []),
    `Board (approvals, sharing, statuses): ${boardUrl(t.options.serverUrl)}`
  ].join('\n\n')
}

export async function join ($: EngineInterface, t: Talkie, id: string): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await relayOf($, t).accept(id)
  if (!res.ok) return res.status === 404 ? `No invite is called ${id}; /talkie teams lists yours.` : `Not joined: ${why(res)}.`
  return `Joined ${res.value.name} (${res.value.slug}) as ${res.value.role}. /talkie share ${res.value.slug} shares this session there.`
}

export async function share ($: EngineInterface, t: Talkie, slug: string): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await relayOf($, t).share(slug, t.identity.name)
  if (res.ok) return `This session is shared in ${slug} as ${res.value}.`
  if (res.status === 409) return `Another member's agent is called ${t.identity.name} in ${slug}; rename this session with /talkie name <name>, then share again.`
  return res.status === 404 ? `You are in no team called ${slug}; /talkie teams lists yours.` : `Not shared: ${why(res)}.`
}

export async function unshare ($: EngineInterface, t: Talkie, slug: string): Promise<string> {
  if (!t.auth) return SIGN_IN
  const res = await relayOf($, t).unshare(slug, t.identity.name)
  return res.ok ? `This session is no longer shared in ${slug}.` : `Not unshared: ${why(res)}.`
}
