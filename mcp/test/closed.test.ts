import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

it('says a message to a closed session waits in case it resumes', async () => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-closed-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  await agent.start('cx')
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: false, closed: true, to: 'cc:fuzzy-mole', status: 'queued' } })
  expect(await agent.send('cc:fuzzy-mole', 'merged')).toMatch(/cc:fuzzy-mole has closed[^]*resumes within 24 h/)
})
