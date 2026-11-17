import { describe, expect, it } from 'vitest'
import {
  BlockedByPublisherError, ClawalkietalkieError, FollowerLimitError, FollowLimitError, InvalidCursorError, NotStreamingError, TextTooLongError
} from '../src/index.ts'
import { errorFor } from '../src/errors.ts'
import { setup } from './helpers.ts'

const pair = async () => {
  const { relay, client } = setup()
  const publisher = client.agent({ name: 'pub', client: 'example', instanceId: 'ip' })
  const follower = client.agent({ name: 'fan', client: 'example', instanceId: 'if' })
  await Promise.all([publisher.claim(), follower.claim()])
  return { relay, client, publisher, follower }
}

describe('streaming and posting', () => {
  it('turns streaming on with the holder, and answers the setting', async () => {
    const { relay, publisher } = await pair()
    expect(await publisher.setStreaming({ on: true, includeStatus: true })).toEqual({ on: true, includeStatus: true })
    const call = relay.callsTo(/\/streaming$/)[0]!
    expect(call).toMatchObject({ method: 'PUT', path: '/v1/sessions/pub/streaming', body: { instanceId: 'ip', on: true, includeStatus: true } })
  })

  it('sends includeStatus only when given', async () => {
    const { relay, publisher } = await pair()
    await publisher.setStreaming({ on: false })
    expect(relay.callsTo(/\/streaming$/)[0]!.body).toEqual({ instanceId: 'ip', on: false })
  })

  it('posts an update and answers its id', async () => {
    const { relay, publisher } = await pair()
    await publisher.setStreaming({ on: true })
    expect(await publisher.postUpdate('tests green')).toEqual({ id: 1 })
    expect(relay.callsTo(/^\/v1\/updates$/, 'POST')[0]!.body).toEqual({ from: 'pub', instanceId: 'ip', text: 'tests green' })
  })

  it('refuses an empty or over-long update before calling the relay', async () => {
    const { relay, publisher } = await pair()
    await expect(publisher.postUpdate('')).rejects.toMatchObject({ code: 'invalid_request' })
    const tooLong = await publisher.postUpdate('x'.repeat(2001)).catch((e: unknown) => e) as TextTooLongError
    expect(tooLong).toBeInstanceOf(TextTooLongError)
    expect(tooLong.max).toBe(2000)
    expect(relay.callsTo(/^\/v1\/updates$/)).toHaveLength(0)
  })

  it('throws NotStreamingError when posting with streaming off', async () => {
    const { publisher } = await pair()
    const error = await publisher.postUpdate('x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotStreamingError)
    expect(error).toBeInstanceOf(ClawalkietalkieError)
    expect(error).toMatchObject({ code: 'not_streaming', status: 409 })
  })
})

describe('following', () => {
  it('follows a streaming agent and reads its updates from the feed', async () => {
    const { relay, publisher, follower } = await pair()
    await publisher.setStreaming({ on: true })
    expect(await follower.follow('cc:pub')).toEqual({ to: 'ex:pub' })
    expect(relay.callsTo(/^\/v1\/follows$/, 'PUT')[0]!.body).toEqual({ from: 'fan', instanceId: 'if', to: 'cc:pub' })
    await publisher.postUpdate('step 1 done')
    const page = await follower.updates()
    expect(page.updates).toEqual([expect.objectContaining({ id: 1, from: 'ex:pub', kind: 'post', text: 'step 1 done' })])
    expect(page.cursor).toBe('u1')
    expect(relay.callsTo(/^\/v1\/updates$/, 'GET')[0]!.query.get('instanceId')).toBe('if')
  })

  it('reads on from a cursor, long-polling with wait', async () => {
    const { relay, publisher, follower } = await pair()
    await publisher.setStreaming({ on: true })
    await follower.follow('pub')
    await publisher.postUpdate('one')
    const first = await follower.updates()
    const waiting = follower.updates({ after: first.cursor, wait: 5 })
    await publisher.postUpdate('two')
    const next = await waiting
    expect(next.updates.map((u) => u.text)).toEqual(['two'])
    const query = relay.callsTo(/^\/v1\/updates$/, 'GET')[1]!.query
    expect([query.get('after'), query.get('wait')]).toEqual(['u1', '5'])
  })

  it('caps wait at 50 seconds', async () => {
    const { relay, follower } = await pair()
    const pending = follower.updates({ wait: 0 })
    await pending
    relay.state.waitScaleMs = 0
    await follower.updates({ wait: 500 })
    expect(relay.callsTo(/^\/v1\/updates$/, 'GET')[1]!.query.get('wait')).toBe('50')
  })

  it('throws NotStreamingError with the hint when the publisher is not streaming', async () => {
    const { follower } = await pair()
    const error = await follower.follow('cc:pub').catch((e: unknown) => e) as NotStreamingError
    expect(error).toBeInstanceOf(NotStreamingError)
    expect(error.hint).toBe('ex:pub is not streaming')
  })

  it('throws FollowLimitError carrying max', async () => {
    const { relay, client, follower } = await pair()
    for (const name of ['a1', 'a2', 'a3']) {
      await client.agent({ name, client: 'example', instanceId: name }).setStreaming({ on: true })
    }
    await follower.follow('a1')
    await follower.follow('a2')
    const error = await follower.follow('a3').catch((e: unknown) => e) as FollowLimitError
    expect(error).toBeInstanceOf(FollowLimitError)
    expect(error.max).toBe(2)
    expect(relay.callsTo(/^\/v1\/follows$/, 'PUT')).toHaveLength(3)
  })

  it('throws FollowerLimitError carrying max when the publisher has as many followers as allowed', async () => {
    const { relay, publisher, follower } = await pair()
    relay.state.streams.maxFollowers = 0
    await publisher.setStreaming({ on: true })
    const error = await follower.follow('pub').catch((e: unknown) => e) as FollowerLimitError
    expect(error).toBeInstanceOf(FollowerLimitError)
    expect(error.max).toBe(0)
    expect(error.message).toMatch(/has as many followers as allowed/)
  })

  it('unfollows, and lists follows with whether each is active', async () => {
    const { relay, publisher, follower } = await pair()
    await publisher.setStreaming({ on: true })
    await follower.follow('pub')
    expect(await follower.following()).toEqual([expect.objectContaining({ to: 'ex:pub', active: true })])
    await publisher.setStreaming({ on: false })
    expect((await follower.following())[0]!.active).toBe(false)
    await follower.unfollow('cc:pub')
    expect(relay.callsTo(/^\/v1\/follows$/, 'DELETE')[0]!.body).toEqual({ from: 'fan', instanceId: 'if', to: 'cc:pub' })
    expect(await follower.following()).toEqual([])
  })

  it('refuses an address that is not one before calling the relay', async () => {
    const { relay, follower } = await pair()
    await expect(follower.follow('Not An Address!')).rejects.toMatchObject({ code: 'invalid_address' })
    expect(relay.callsTo(/^\/v1\/follows$/)).toHaveLength(0)
  })
})

describe('followers', () => {
  it('lists followers and blocked ones, removes (and blocks) a follower, and unblocks it', async () => {
    const { relay, publisher, follower } = await pair()
    await publisher.setStreaming({ on: true })
    await follower.follow('pub')
    expect(await publisher.followers()).toEqual({ followers: [expect.objectContaining({ address: 'ex:fan' })], blocked: [] })
    await publisher.removeFollower('ex:fan')
    expect(relay.callsTo(/^\/v1\/followers$/, 'DELETE')[0]!.body).toEqual({ from: 'pub', instanceId: 'ip', follower: 'ex:fan' })
    expect(await publisher.followers()).toEqual({ followers: [], blocked: [expect.objectContaining({ address: 'ex:fan' })] })
    const error = await follower.follow('pub').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BlockedByPublisherError)
    await publisher.unblockFollower('ex:fan')
    expect(relay.callsTo(/^\/v1\/followers\/blocks$/, 'DELETE')[0]!.body).toEqual({ from: 'pub', instanceId: 'ip', follower: 'ex:fan' })
    expect(await follower.follow('pub')).toEqual({ to: 'ex:pub' })
  })

  it('reads followers with the holder in the query', async () => {
    const { relay, publisher } = await pair()
    await publisher.followers()
    const query = relay.callsTo(/^\/v1\/followers$/, 'GET')[0]!.query
    expect([query.get('from'), query.get('instanceId')]).toEqual(['pub', 'ip'])
  })
})

describe('the split refusal codes', () => {
  it('maps each to its typed error with a plain message', () => {
    const tooLong = errorFor(400, 'text_too_long', { max: 2000 }) as TextTooLongError
    expect(tooLong).toBeInstanceOf(TextTooLongError)
    expect(tooLong.max).toBe(2000)
    expect(tooLong.message).toMatch(/at most 2000 characters/)
    const followers = errorFor(409, 'follower_limit', { max: 100 }) as FollowerLimitError
    expect(followers).toBeInstanceOf(FollowerLimitError)
    expect(followers.max).toBe(100)
    const follows = errorFor(409, 'follow_limit', { max: 50 }) as FollowLimitError
    expect(follows.message).toMatch(/This agent follows as many agents as allowed/)
    const cursor = errorFor(400, 'invalid_cursor')
    expect(cursor).toBeInstanceOf(InvalidCursorError)
    expect(cursor.message).toMatch(/cursor/)
  })
})
