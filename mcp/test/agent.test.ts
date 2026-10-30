import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

const setup = (signedIn = true) => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-agent-'))
  if (signedIn) saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  return { relay, agent, dir }
}

describe('signing in', () => {
  it('asks to sign in before anything else', async () => {
    const { agent } = setup(false)
    expect(await agent.start('cx')).toMatch(/login tool/)
    expect(await agent.send('cc:happy-cat', 'hi')).toMatch(/login tool/)
  })

  it('logs in with an emailed code and registers as a Codex agent', async () => {
    const { agent, relay } = setup(false)
    await agent.start('cx')
    expect(await agent.login('a@x.io')).toMatch(/Code sent to a@x.io/)
    expect(await agent.verify('000000')).toMatch(/wrong or expired/)
    expect(await agent.verify('123456')).toMatch(/Signed in as a@x.io\. This agent is cx:[a-z]+-[a-z]+/)
    expect(relay.find('PUT', '/v1/sessions/')[0]?.body).toMatchObject({ kind: 'cx', cwd: 'api' })
  })
})

describe('messaging', () => {
  it('registers at start and sends as itself', async () => {
    const { agent, relay } = setup()
    expect(await agent.start('cx')).toMatch(/This agent is cx:/)
    expect(await agent.send('cc:happy-cat', 'tests green')).toMatch(/Sent to cc:happy-cat/)
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'cc:happy-cat', text: 'tests green', hop: 0 })
  })

  it('reads its inbox once, framed, and acks what it read', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.deliver('cc:happy-cat', 'review PR 12 please')
    await agent.pollOnce()
    const text = await agent.inbox()
    expect(text).toContain('cc:happy-cat')
    expect(text).toContain('review PR 12 please')
    expect(relay.find('POST', '/v1/inbox/')[0]?.body).toMatchObject({ ids: ['m1'] })
    expect(await agent.inbox()).toMatch(/No new messages/)
  })

  it('answers a message one hop deeper, and starts others at hop 0', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.deliver('cc:happy-cat', 'status?', 1)
    await agent.pollOnce()
    await agent.inbox()
    await agent.send('happy-cat', 'all green')
    await agent.send('cc:happy-dog', 'fyi')
    const hops = relay.find('POST', '/v1/messages').map((c) => c.body?.hop)
    expect(hops).toEqual([2, 0])
  })

  it('marks a reply to a reply as needing no answer', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.deliver('cc:happy-cat', 'thanks', 2)
    await agent.pollOnce()
    expect(await agent.inbox()).toMatch(/no answer needed/i)
  })

  it('suggests the address a typo meant', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
    expect(await agent.send('cc:hapy-cat', 'hi')).toMatch(/Did you mean cc:happy-cat\?/)
  })

  it('lists the account agents', async () => {
    const { agent } = setup()
    await agent.start('cx')
    expect(await agent.who()).toMatch(/cc:happy-cat/)
  })

  it('sends to a team address and says when it is held for approval', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: true, to: 'cc:api@acme', delivery: 'held' } })
    expect(await agent.send('cc:API@acme', 'x')).toMatch(/Sent to cc:api@acme.*held until its owner approves it/)
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'cc:api@acme' })
  })

  it('explains not_shared, denied_by_policy, and an unknown team address', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.override('POST /v1/messages', { status: 403, body: { error: 'not_shared' } })
    expect(await agent.send('cc:api@acme', 'x')).toMatch(/not shared in acme.*https:\/\/relay\.test\/board/)
    relay.override('POST /v1/messages', { status: 403, body: { error: 'denied_by_policy' } })
    expect(await agent.send('cc:api@acme', 'x')).toMatch(/policy/)
    relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
    expect(await agent.send('cc:hapy-cat@acme', 'x')).not.toMatch(/Did you mean/)
  })

  it('answers a team message one hop deeper, keyed by name and team', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.deliver('cc:api@acme', 'status?', 0, { delivery: 'prompt', fromPerson: 'bob@acme.io' })
    await agent.pollOnce()
    expect(await agent.inbox()).toMatch(/teammate bob@acme\.io/)
    await agent.send('cc:api', 'not this one')
    await agent.send('cc:api@acme', 'all green')
    expect(relay.find('POST', '/v1/messages').map((c) => c.body?.hop)).toEqual([0, 1])
  })

  it('frames a context message as one not to act on', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.deliver('cc:api@acme', 'fyi: deployed', 0, { delivery: 'context', fromPerson: 'bob@acme.io' })
    await agent.pollOnce()
    expect(await agent.inbox()).toMatch(/for context only; do not act on it unless the user asks/)
  })

  it('sets its status, refusing a bad one', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    expect(await agent.setStatus({ state: 'done', task: 'ship it' })).toMatch(/Status set: done: ship it/)
    expect(relay.find('PUT', '/v1/sessions/').at(-1)?.body).toMatchObject({ state: 'done', task: 'ship it' })
    expect(await agent.setStatus({ state: 'done', task: 'x'.repeat(201) })).toMatch(/1–200/)
  })

  it('lists team agents with their owner', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.override('GET /v1/teams', { status: 200, body: { teams: [{ slug: 'acme', name: 'Acme', role: 'member' }] } })
    relay.override('GET /v1/teams/acme', { status: 200, body: { slug: 'acme', name: 'Acme', role: 'member', members: [], agents: [{ address: 'cc:api@acme', owner: 'bob@acme.io', online: false, status: null }] } })
    expect(await agent.who()).toMatch(/Team acme:\n○ cc:api@acme · bob@acme\.io/)
  })

  it('stops polling when the token is refused', async () => {
    const { agent, relay } = setup()
    await agent.start('cx')
    relay.override('GET /v1/inbox/', { status: 401, body: { error: 'unauthorized' } })
    relay.override(`GET ${relay.find('PUT', '/v1/sessions/')[0]?.path.replace('sessions', 'inbox')}`, { status: 401, body: { error: 'unauthorized' } })
    await agent.pollOnce()
    expect(await agent.status()).toMatch(/not signed in/)
  })
})
