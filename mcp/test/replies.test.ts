import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'
import { retryDelay } from '../src/poll.ts'
import { createServer } from '../src/server.ts'

type Relay = ReturnType<typeof createFakeRelay>

const agentOn = (relay: Relay, dir: string) =>
  createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })

const setup = async () => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-replies-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = agentOn(relay, dir)
  await agent.start('cx')
  return { relay, agent, dir }
}

const afters = (relay: Relay) => relay.find('GET', '/v1/inbox/').map((c) => new URLSearchParams(c.path.split('?')[1]).get('after'))

describe('replies', () => {
  it('send threads a message under the one it answers with reply_to', async () => {
    const { agent, relay } = await setup()
    relay.deliver('cc:happy-cat', 'status?')
    await agent.inbox()
    expect(await agent.send('cc:happy-cat', 'green', { type: 'note', replyTo: 'm1' })).toMatch(/Sent to cc:happy-cat/)
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ replyTo: 'm1', hop: 1, type: 'note' })
    expect(await agent.send('cc:happy-cat', 'x', { replyTo: 'nope' })).toMatch(/nope is not a message this agent received/)
  })

  it('the send tool offers reply_to and passes it on', async () => {
    const { agent, relay } = await setup()
    const server = createServer(agent, { poll: false })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'codex-mcp-client', version: '1.0.0' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const send = (await client.listTools()).tools.find((t) => t.name === 'send')
    expect(Object.keys(send?.inputSchema.properties ?? {})).toContain('reply_to')
    relay.deliver('cc:happy-cat', 'status?')
    expect(await client.callTool({ name: 'inbox', arguments: {} })).toBeTruthy()
    await client.callTool({ name: 'send', arguments: { to: 'cc:happy-cat', text: 'ok', type: 'request', reply_to: 'm1' } })
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ replyTo: 'm1', type: 'request' })
  })

  it('the inbox shows the id to reply to', async () => {
    const { agent, relay } = await setup()
    relay.deliver('cc:happy-cat', 'status?')
    expect(await agent.inbox()).toMatch(/reply_to: "m1"/)
  })
})

describe('the inbox cursor', () => {
  it('polls on from the cursor, and keeps it on disk per identity once it has shown everything', async () => {
    const { agent, relay, dir } = await setup()
    relay.deliver('cc:happy-cat', 'one')
    await agent.pollOnce()
    await agent.inbox()
    await agent.pollOnce()
    expect(afters(relay)).toEqual([null, 'c1', 'c1'])
    const stored = JSON.parse(readFileSync(join(dir, 'cursors.json'), 'utf8')) as Record<string, string>
    expect(Object.values(stored)).toEqual(['c1'])
    expect(relay.waiting()).toBe(0)
  })

  it('a restarted agent resumes from the stored cursor', async () => {
    const { agent, relay, dir } = await setup()
    relay.deliver('cc:happy-cat', 'one')
    await agent.inbox()
    const again = agentOn(relay, dir)
    await again.start('cx')
    relay.deliver('cc:happy-cat', 'two')
    expect(await again.inbox()).toMatch(/two/)
    expect(afters(relay).at(-1)).toBe('c1')
  })

  it('does not keep a cursor past messages it has not shown yet', async () => {
    const { agent, relay, dir } = await setup()
    relay.deliver('cc:happy-cat', 'unread')
    await agent.pollOnce()
    const again = agentOn(relay, dir)
    await again.start('cx')
    expect(await again.inbox()).toMatch(/unread/)
  })

  it('drops a cursor the relay rejects and reads from the start', async () => {
    const { agent, relay, dir } = await setup()
    relay.deliver('cc:happy-cat', 'one')
    await agent.inbox()
    const name = relay.find('PUT', '/v1/sessions/')[0]!.path.slice('/v1/sessions/'.length)
    relay.override(`GET /v1/inbox/${name}`, { status: 400, body: { error: 'invalid_cursor' } })
    expect(await agent.pollOnce()).toBe(false)
    relay.restore(`GET /v1/inbox/${name}`)
    relay.deliver('cc:happy-cat', 'two')
    expect(await agent.inbox()).toMatch(/two/)
    expect(afters(relay)).toEqual([null, 'c1', null, null])
    expect(readFileSync(join(dir, 'cursors.json'), 'utf8')).toMatch(/c2/)
  })
})

describe('reconnecting', () => {
  it('backs off on errors, doubling with ±20% jitter, and polls quickly when well', () => {
    expect(retryDelay({ ok: true, backoffMs: 0 }, Math.random)).toEqual({ delayMs: 250, backoffMs: 0 })
    let backoffMs = 0
    for (const base of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
      const next = retryDelay({ ok: false, backoffMs }, Math.random)
      expect(next.backoffMs).toBe(base)
      expect(next.delayMs >= base * 0.8 && next.delayMs < base * 1.2).toBe(true)
      backoffMs = next.backoffMs
    }
    expect(retryDelay({ ok: false, backoffMs: 0 }, () => 0).delayMs).toBe(800)
  })
})
