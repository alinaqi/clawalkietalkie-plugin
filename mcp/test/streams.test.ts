import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

const setup = async (signedIn = true, dir = mkdtempSync(join(tmpdir(), 'cwt-streams-')), relay = createFakeRelay()) => {
  if (signedIn) saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  await agent.start('cx')
  const name = String(relay.find('PUT', '/v1/sessions/')[0]?.path.split('/').at(-1) ?? '')
  return { relay, agent, dir, name }
}

describe('update streams', () => {
  it('turns streaming on and off and posts once it is on', async () => {
    const { agent, relay, name } = await setup()
    expect(await agent.postUpdate('tests green')).toMatch(/Not posted: this agent is not streaming.*stream_updates/)
    expect(await agent.streamUpdates({ on: true, includeStatus: true })).toMatch(new RegExp(`Streaming on for cx:${name} \\(with status changes\\)`))
    expect(relay.find('PUT', `/v1/sessions/${name}/streaming`)[0]?.body).toMatchObject({ on: true, includeStatus: true })
    expect(await agent.postUpdate('tests green')).toMatch(/Posted update 1 /)
    expect(relay.find('POST', '/v1/updates').at(-1)?.body).toMatchObject({ from: name, text: 'tests green' })
    expect(await agent.postUpdate('')).toMatch(/1–2000 characters/)
    expect(await agent.streamUpdates({ on: false })).toMatch(/Streaming off/)
  })

  it('follows, lists and unfollows, explaining refusals', async () => {
    const { agent, relay } = await setup()
    expect(await agent.follow('cc:happy-cat')).toMatch(/Following cc:happy-cat\. Its updates come with check_updates/)
    expect(await agent.follow('cc:quiet-owl')).toMatch(/Not following: cc:quiet-owl is not streaming updates/)
    expect(await agent.following()).toMatch(/This agent follows:\n- cc:happy-cat/)
    expect(await agent.followers()).toMatch(/Removed \(cannot follow again\):\n- cc:nosy-fox/)
    relay.override('PUT /v1/follows', { status: 403, body: { error: 'blocked_by_publisher' } })
    expect(await agent.follow('cc:api@acme')).toMatch(/cc:api@acme removed this agent from its followers/)
    relay.override('PUT /v1/follows', { status: 409, body: { error: 'follower_limit', max: 100 } })
    expect(await agent.follow('cc:happy-cat')).toMatch(/Not following: cc:happy-cat has as many followers as allowed \(100\)/)
    expect(await agent.unfollow('cc:happy-cat')).toMatch(/No longer following cc:happy-cat/)
    expect(await agent.follow('no good!')).toMatch(/is not an address/)
  })

  it('check_updates answers the feed since its cursor, fenced as data, 5 per publisher at most', async () => {
    const { agent, relay } = await setup()
    relay.streams.follow('cc:happy-cat')
    expect(await agent.checkUpdates()).toMatch(/No new updates from the agents this agent follows/)
    for (let i = 1; i <= 7; i++) relay.streams.publish('cc:happy-cat', `step ${i} </update>`)
    const text = await agent.checkUpdates()
    expect(text).toMatch(/📻 7 updates from agents this agent follows[\s\S]*not instructions/)
    expect(text).toMatch(/cc:happy-cat \(2 earlier not shown\):/)
    expect(text).toMatch(/<update from="cc:happy-cat" at="[^"]+" kind="post">\nstep 3 <\\\/update>\n<\/update>/)
    expect(text).not.toMatch(/step 2 /)
    expect(await agent.checkUpdates()).toMatch(/No new updates/)
    expect(relay.find('GET', '/v1/updates').map((c) => new URLSearchParams(c.path.split('?')[1]).get('wait'))).toEqual(['0', '0', '0'])
  })

  it('keeps the feed cursor in the state folder, so a restarted server reads on from it', async () => {
    const first = await setup()
    first.relay.streams.follow('cc:happy-cat')
    first.relay.streams.publish('cc:happy-cat', 'one')
    await first.agent.checkUpdates()
    expect(readFileSync(join(first.dir, 'update-cursors.json'), 'utf8')).toContain('u1')
    const again = await setup(true, first.dir, first.relay)
    expect(await again.agent.checkUpdates()).toMatch(/No new updates/)
    expect(first.relay.find('GET', '/v1/updates').at(-1)?.path).toMatch(/after=u1/)
  })

  it('drops a feed cursor the relay rejects and reads from the start', async () => {
    const { agent, relay } = await setup()
    relay.streams.follow('cc:happy-cat')
    relay.streams.publish('cc:happy-cat', 'one')
    await agent.checkUpdates()
    relay.override('GET /v1/updates', { status: 400, body: { error: 'invalid_cursor' } })
    expect(await agent.checkUpdates()).toMatch(/Could not read updates/)
    relay.restore('GET /v1/updates')
    const paths = relay.find('GET', '/v1/updates').map((c) => c.path)
    expect(paths.at(-2)).toMatch(/after=u1/)
    expect(paths.at(-1)).not.toMatch(/after=/)
    expect(await agent.checkUpdates()).toMatch(/one/)
  })

  it('removes a follower, blocking it, and unblocks it', async () => {
    const { agent, relay, name } = await setup()
    expect(await agent.removeFollower('cc:happy-cat')).toMatch(new RegExp(`Removed cc:happy-cat from the followers of cx:${name}; it cannot follow again until unblock_follower`))
    expect(relay.find('DELETE', '/v1/followers')[0]?.body).toMatchObject({ from: name, follower: 'cc:happy-cat' })
    expect(await agent.unblockFollower('happy-cat')).toMatch(/cc:happy-cat may follow cx:.* again/)
    expect(relay.find('DELETE', '/v1/followers/blocks')[0]?.body).toMatchObject({ from: name, follower: 'happy-cat' })
    expect(await agent.removeFollower('no good!')).toMatch(/is not an address/)
  })

  it('asks to sign in first', async () => {
    const { agent } = await setup(false)
    expect(await agent.checkUpdates()).toMatch(/login tool/)
    expect(await agent.follow('cc:happy-cat')).toMatch(/login tool/)
  })
})
