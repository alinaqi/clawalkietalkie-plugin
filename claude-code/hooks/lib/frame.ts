// Text the mod shows the person and hands the model.

import { formatAddress, parseTarget } from './address.ts'
import type { InboxMessage, SessionInfo } from './relay.ts'

// The relay only routes within one account, so the sender is another of the person's own sessions.
export const frameIncoming = (message: InboxMessage, self: string): string => {
  const body = message.text.replaceAll('</message>', '<\\/message>')
  return [
    `📻 ${message.from} says (a message to this session, ${formatAddress(self)}, from another of your own coding agents, via clawalkietalkie):`,
    '',
    '<message>',
    body,
    '</message>',
    '',
    (message.hop ?? 0) >= 1
      ? `This is a reply to a message one of your sessions sent. Use it; answer ${message.from} only if something it asks is still open.`
      : `Act on it as you would on a request from the person. To answer, call the clawalkietalkie send tool with to: "${message.from}".`
  ].join('\n')
}

export const parseSendArgs = (args: string): { to: string, text: string } | null => {
  const match = /^\s*(\S+)\s+([\s\S]*\S)\s*$/.exec(args)
  const target = match?.[1] ? parseTarget(match[1]) : null
  if (!target || !match?.[2]) return null
  return { to: target.kind ? formatAddress(target.name, target.kind) : target.name, text: match[2] }
}

const ago = (ms: number): string => {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export const formatWho = (sessions: readonly SessionInfo[], at: { self: string, now: number }): string => {
  if (sessions.length === 0) return 'No sessions are registered on this account yet.'
  return sessions.map((s) => {
    const mark = s.online ? '●' : '○'
    const you = s.address === formatAddress(at.self) ? ' (this session)' : ''
    const place = [s.host, s.cwd].filter(Boolean).join(':')
    const seen = s.online ? 'online' : `last seen ${ago(at.now - s.lastSeen)}`
    return `${mark} ${s.address}${you} · ${[place, seen].filter(Boolean).join(' · ')}`
  }).join('\n')
}

// The last folder of a path, with either separator, so Windows paths name their folder too.
export const folderName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
