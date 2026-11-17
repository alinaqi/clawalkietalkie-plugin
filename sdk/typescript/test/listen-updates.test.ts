import { describe, expect, it } from 'vitest'
import type { Update } from '../src/index.ts'
import { setup, until } from './helpers.ts'

const FAST = { waitSeconds: 25, backoff: { minMs: 1, maxMs: 8 }, random: () => 0.5 }

const following = async () => {
  const { relay, client } = setup()
  const publisher = client.agent({ name: 'pub', client: 'example', instanceId: 'ip' })
  const follower = client.agent({ name: 'fan', client: 'example', instanceId: 'if' })
  await publisher.setStreaming({ on: true })
  await follower.follow('pub')
  return { relay, publisher, follower }
}

const feedPolls = (relay: ReturnType<typeof setup>['relay']) => relay.callsTo(/^\/v1\/updates$/, 'GET')

describe('listen with onUpdate', () => {
  it('hands each update to onUpdate, reading on from its own cursor', async () => {
    const { relay, publisher, follower } = await following()
    const seen: Update[] = []
    const stop = follower.listen(async () => {}, { ...FAST, onUpdate: (u) => { seen.push(u) } })
    await publisher.postUpdate('one')
    await until(() => seen.length === 1)
    await publisher.postUpdate('two')
    await until(() => seen.length === 2)
    await stop()
    expect(seen.map((u) => [u.from, u.kind, u.text])).toEqual([['ex:pub', 'post', 'one'], ['ex:pub', 'post', 'two']])
    expect(feedPolls(relay)[0]!.query.get('after')).toBeNull()
    expect(feedPolls(relay).at(-1)!.query.get('after')).toBe('u2')
    expect(feedPolls(relay)[0]!.query.get('wait')).toBe('25')
  })

  it('does not poll the feed without onUpdate', async () => {
    const { relay, follower } = await following()
    const stop = follower.listen(async () => {}, FAST)
    await until(() => relay.callsTo(/^\/v1\/inbox\/fan$/).length > 0)
    await stop()
    expect(feedPolls(relay)).toHaveLength(0)
  })

  it('keeps messages flowing while onUpdate runs', async () => {
    const { relay, publisher, follower } = await following()
    const messages: string[] = []
    let release = () => {}
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const stop = follower.listen(async (m) => { messages.push(m.id) }, { ...FAST, onUpdate: () => blocked })
    await publisher.postUpdate('slow')
    await until(() => feedPolls(relay).length >= 1)
    relay.deliver('fan', { id: 'm1', from: 'ex:pub', text: 'hi' })
    await until(() => messages.length === 1)
    release()
    await stop()
  })

  it('backs off on feed errors with its own backoff, reporting them, and resumes', async () => {
    const { relay, publisher, follower } = await following()
    for (let i = 0; i < 3; i++) relay.fail({ path: /^\/v1\/updates$/, method: 'GET', status: 503, body: { error: 'busy' } })
    const delays: number[] = []
    const seen: string[] = []
    const stop = follower.listen(async () => {}, { ...FAST, onUpdate: (u) => { seen.push(u.text) }, onError: (_e, info) => { delays.push(info.delayMs) } })
    await publisher.postUpdate('after errors')
    await until(() => seen.length === 1)
    await stop()
    expect(delays).toEqual([1, 2, 4])
  })

  it('an onUpdate that throws is reported, and the feed moves on', async () => {
    const { publisher, follower } = await following()
    const errors: unknown[] = []
    const seen: string[] = []
    const stop = follower.listen(async () => {}, {
      ...FAST,
      onUpdate: (u) => { seen.push(u.text); if (u.text === 'bad') throw new Error('boom') },
      onError: (e) => { errors.push(e) }
    })
    await publisher.postUpdate('bad')
    await publisher.postUpdate('good')
    await until(() => seen.length === 2)
    await stop()
    expect(seen).toEqual(['bad', 'good'])
    expect(errors).toHaveLength(1)
  })

  it('reads the feed from the start when the relay refuses the cursor, without handing an update twice', async () => {
    const { relay, publisher, follower } = await following()
    const seen: number[] = []
    const stop = follower.listen(async () => {}, { ...FAST, onUpdate: (u) => { seen.push(u.id) } })
    await publisher.postUpdate('one')
    await until(() => seen.length === 1)
    relay.fail({ path: /^\/v1\/updates$/, method: 'GET', status: 400, body: { error: 'invalid_request' } })
    await publisher.postUpdate('two')
    await until(() => seen.length === 2)
    await stop()
    expect(seen).toEqual([1, 2])
  })

  it('stop() ends both long-polls at once', async () => {
    const { relay, follower } = await following()
    relay.state.waitScaleMs = 10_000
    const stop = follower.listen(async () => {}, { ...FAST, onUpdate: () => {} })
    await until(() => feedPolls(relay).length === 1 && relay.callsTo(/^\/v1\/inbox\/fan$/).length === 1)
    const started = Date.now()
    await stop()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('stops the feed for good when the token is no longer valid', async () => {
    const { relay, follower } = await following()
    relay.fail({ path: /^\/v1\/updates$/, method: 'GET', status: 401, body: { error: 'unauthorized' } })
    const infos: Array<{ fatal: boolean }> = []
    const stop = follower.listen(async () => {}, { ...FAST, onUpdate: () => {}, onError: (_e, info) => { infos.push(info) } })
    await until(() => infos.length === 1)
    await new Promise((r) => setTimeout(r, 20))
    await stop()
    expect(infos[0]!.fatal).toBe(true)
    expect(feedPolls(relay)).toHaveLength(1)
  })
})
