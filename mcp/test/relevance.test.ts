import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

const agentWith = async () => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-relevance-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  await agent.start('cx')
  return { agent, relay }
}

describe('send with about', () => {
  it('passes the project to the relay', async () => {
    const { agent, relay } = await agentWith()
    await agent.send('cc:happy-cat', 'PR ready', { type: 'note', about: 'srooter' })
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ about: 'srooter' })
  })

  it('explains an unrelated recipient, with the agents on that project', async () => {
    const { agent, relay } = await agentWith()
    relay.override('POST /v1/messages', { status: 409, body: { error: 'unrelated_recipient', project: 'soundingboard', suggest: ['cc:lucky-crane'] } })
    const text = await agent.send('cc:happy-cat', 'merge it', { about: 'srooter' })
    expect(text).toMatch(/Not sent: cc:happy-cat works on soundingboard/)
    expect(text).toMatch(/cc:lucky-crane/)
  })

  it('says to stop and ask the user when the exchange goes in circles', async () => {
    const { agent, relay } = await agentWith()
    relay.override('POST /v1/messages', { status: 429, body: { error: 'loop_guard', reason: 'thread_too_long' } })
    expect(await agent.send('cc:happy-cat', 'again')).toMatch(/going in circles.*ask the user/is)
  })
})

describe('discard', () => {
  it('drops messages at the relay', async () => {
    const { agent, relay } = await agentWith()
    expect(await agent.discard(['m1', 'm2'])).toMatch(/Discarded 2 messages/)
    expect(relay.find('POST', '/v1/inbox/').find((c) => c.path.endsWith('/discard'))?.body).toMatchObject({ ids: ['m1', 'm2'] })
  })

  it('is offered in the inbox for a message that is not about this agent\'s work', async () => {
    const { agent, relay } = await agentWith()
    relay.deliver('cc:happy-cat', 'merge PR 2184')
    expect(await agent.inbox()).toMatch(/not about this agent's work, call discard with ids: \["m1"\]/i)
  })
})
