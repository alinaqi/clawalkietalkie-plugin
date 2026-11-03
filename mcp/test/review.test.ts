import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

const setup = async () => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-review-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const gate = { open: Promise.resolve(), release: () => {} }
  const fetch = async (url: string, init?: Parameters<typeof relay.fetch>[1]) => {
    if (url.includes('/v1/inbox/') && !url.includes('/ack')) await gate.open
    return relay.fetch(url, init)
  }
  const agent = createAgent({ fetch, dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  await agent.start('cx')
  const hold = () => { gate.open = new Promise((resolve) => { gate.release = resolve }) }
  return { relay, agent, dir, hold, release: () => gate.release() }
}

const cursors = (dir: string): string => existsSync(join(dir, 'cursors.json')) ? readFileSync(join(dir, 'cursors.json'), 'utf8') : '{}'

describe('review fixes', () => {
  it('shows the id of a hop-1 reply so the agent can answer it with reply_to', async () => {
    const { agent, relay } = await setup()
    relay.deliver('cc:happy-cat', 'all green, anything else?', 1)
    expect(await agent.inbox()).toMatch(/reply_to: "m1"/)
  })

  it('drops a poll that comes back after a rename: no messages or cursor for the new name', async () => {
    const { agent, relay, dir, hold, release } = await setup()
    relay.deliver('cc:happy-cat', 'for the old name')
    hold()
    const polling = agent.pollOnce()
    expect(await agent.rename('new-name')).toMatch(/now cx:new-name/)
    release()
    await polling
    expect(agent.pending()).toBe(0)
    expect(cursors(dir)).not.toMatch(/c1/)
  })

  it('keeps the cursor off disk until the ack of what it showed succeeds, and acks it again later', async () => {
    const { agent, relay, dir } = await setup()
    relay.deliver('cc:happy-cat', 'one')
    const name = relay.find('PUT', '/v1/sessions/')[0]!.path.slice('/v1/sessions/'.length)
    relay.override(`POST /v1/inbox/${name}/ack`, { status: 503, body: { error: 'down' } })
    expect(await agent.inbox()).toMatch(/one/)
    await agent.pollOnce()
    expect(cursors(dir)).not.toMatch(/c1/)
    relay.restore(`POST /v1/inbox/${name}/ack`)
    expect(await agent.inbox()).toMatch(/No new messages/)
    expect(relay.find('POST', `/v1/inbox/${name}/ack`).at(-1)?.body).toMatchObject({ ids: ['m1'] })
    expect(cursors(dir)).toMatch(/c1/)
    expect(relay.waiting()).toBe(0)
  })
})
