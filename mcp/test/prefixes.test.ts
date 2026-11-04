import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'
import { productOf } from '../src/kind.ts'

const agentWith = async (kind = 'cx') => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-prefix-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  await agent.start(kind)
  return { agent, relay }
}

it('names the product of each built-in prefix', () => {
  expect(productOf('cx')).toBe('codex')
  expect(productOf('cu')).toBe('cursor')
  expect(productOf('zz')).toBeUndefined()
})

it('claims as its product', async () => {
  const { relay } = await agentWith('cx')
  expect(relay.find('PUT', '/v1/sessions/')[0]?.body).toMatchObject({ kind: 'cx', client: 'codex' })
})

it('says which account it is signed in as, and when an owner was emailed', async () => {
  const { agent, relay } = await agentWith()
  expect(await agent.who()).toMatch(/^Signed in as a@x\.io/)
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: false, ownerNotified: true, to: 'cc:x', status: 'queued' } })
  expect(await agent.send('cc:x', 'merged')).toMatch(/its owner was emailed/i)
})
