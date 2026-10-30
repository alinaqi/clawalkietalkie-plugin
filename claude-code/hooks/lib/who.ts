// The who listing: the person's own sessions, then each team's shared agents, with their statuses.
// The MCP server bundles this file too.

import { formatAddress } from './address.ts'
import type { AgentStatus, Relay, Result, SessionInfo, StatusBody, TeamDetail } from './relay.ts'

export interface At { self: string, now: number }

const STATES = new Set(['working', 'blocked', 'idle', 'done'])

const ago = (ms: number): string => {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export const statusText = (status: StatusBody): string => {
  const extra = [status.blockedOn && `blocked on ${status.blockedOn}`, status.waitingFor && `waiting for ${status.waitingFor}`]
  const detail = extra.filter(Boolean).map((part) => ` (${part})`).join('')
  return `${status.state}: ${status.task}${detail}`
}

const line = (online: boolean, parts: ReadonlyArray<string | null | undefined | false>): string =>
  `${online ? '●' : '○'} ${parts.filter(Boolean).join(' · ')}`

export const formatWho = (sessions: readonly SessionInfo[], at: At): string => {
  if (sessions.length === 0) return 'No sessions are registered on this account yet.'
  return sessions.map((s) => {
    const you = s.address === formatAddress(at.self) ? ' (this session)' : ''
    const place = [s.host, s.cwd].filter(Boolean).join(':')
    const seen = s.online ? 'online' : `last seen ${ago(at.now - s.lastSeen)}`
    return line(s.online, [`${s.address}${you}`, place, seen, s.status && statusText(s.status)])
  }).join('\n')
}

export const formatTeam = (team: TeamDetail): string => {
  const agents = team.agents.map((a) => line(a.online, [a.address, a.owner, a.status && statusText(a.status)]))
  return [`Team ${team.slug}:`, ...(agents.length > 0 ? agents : ['(no agents shared yet)'])].join('\n')
}

// Teams the relay cannot list are left out, so the person's own sessions always show.
export const describeWho = async (relay: Relay, at: At): Promise<Result<string>> => {
  const [sessions, teams] = await Promise.all([relay.list(), relay.teams()])
  if (!sessions.ok) return sessions
  const details = teams.ok ? await Promise.all((teams.value ?? []).map((team) => relay.team(team.slug))) : []
  const sections = details.flatMap((d) => d.ok ? [formatTeam(d.value)] : [])
  return { ok: true, value: [formatWho(sessions.value, at), ...sections].join('\n\n') }
}

// The status a tool was handed, checked as the relay will check it; a string says what is wrong.
export const parseStatus = (input: Record<string, unknown>): StatusBody | string => {
  const state = String(input.state ?? '')
  const task = String(input.task ?? '').trim()
  if (!STATES.has(state)) return 'The state is one of working, blocked, idle or done.'
  if (task.length < 1 || task.length > 200) return 'The task is 1–200 characters.'
  const optional = (key: string) => typeof input[key] === 'string' && input[key] ? { [key]: input[key] as string } : {}
  return { state: state as AgentStatus['state'], task, ...optional('blockedOn'), ...optional('waitingFor') }
}
