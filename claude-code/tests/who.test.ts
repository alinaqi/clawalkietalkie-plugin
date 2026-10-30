import { expect, test } from 'claude-code/testing'
import { describeWho, formatWho, statusText } from '../hooks/lib/who.ts'
import { createRelay } from '../hooks/lib/relay.ts'
import { createFakeRelay } from './fake-relay.ts'

const working = { state: 'working' as const, task: 'fix login', at: 0 }

test('formatWho marks this session, presence, place and status', async () => {
  const now = 1_000_000
  const text = formatWho([
    { address: 'cc:happy-cat', online: true, lastSeen: now, host: 'mac', cwd: 'api', status: working },
    { address: 'cc:happy-dog', online: true, lastSeen: now, host: 'mac', cwd: 'web', status: null },
    { address: 'cc:old-owl', online: false, lastSeen: now - 3 * 3600_000, host: null, cwd: null }
  ], { self: 'happy-dog', now })
  const lines = text.split('\n')
  expect(lines[0]).toMatch(/● cc:happy-cat .*mac.*api.*working: fix login/)
  expect(lines[1]).toMatch(/● cc:happy-dog \(this session\)/)
  expect(lines[2]).toMatch(/○ cc:old-owl .*3h ago/)
})

test('formatWho says when there is nobody', async () => {
  expect(formatWho([], { self: 'x', now: 0 })).toMatch(/No sessions/)
})

test('statusText names what the agent is blocked on or waiting for', async () => {
  expect(statusText(working)).toBe('working: fix login')
  expect(statusText({ state: 'blocked', task: 'deploy', blockedOn: 'CI' })).toBe('blocked: deploy (blocked on CI)')
  expect(statusText({ state: 'idle', task: 'review', waitingFor: 'cc:api' })).toBe('idle: review (waiting for cc:api)')
})

test('describeWho lists team agents under each team, with owner and status', async () => {
  const fake = createFakeRelay()
  fake.override('GET /v1/teams', { status: 200, body: { teams: [{ slug: 'acme', name: 'Acme', role: 'member' }] } })
  fake.override('GET /v1/teams/acme', { status: 200, body: { slug: 'acme', name: 'Acme', role: 'member', members: [], agents: [{ address: 'cc:api@acme', owner: 'bob@acme.io', online: true, status: working }] } })
  const relay = createRelay(async (url, init) => fake.fetch(url, init), { baseUrl: 'https://relay.test' })
  const res = await describeWho(relay, { self: 'happy-dog', now: 0 })
  expect(res.ok && res.value).toMatch(/cc:happy-cat[\s\S]*\nTeam acme:\n● cc:api@acme · bob@acme\.io · working: fix login/)
})

test('describeWho shows only your own sessions when you are in no team', async () => {
  const fake = createFakeRelay()
  const relay = createRelay(async (url, init) => fake.fetch(url, init), { baseUrl: 'https://relay.test' })
  const res = await describeWho(relay, { self: 'happy-dog', now: 0 })
  expect(res.ok && res.value).not.toMatch(/Team/)
})
