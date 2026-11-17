import { expect, test, type Engine } from 'claude-code/testing'
import { SIGNED_IN, setup, start, talkie, tool } from './harness.ts'

const call = async ($: Engine, name: string, args: Record<string, unknown> = {}) =>
  String((await $.tool.call({ tool: tool(name), ...args })).result ?? '')

test('registers the update-stream tools beside the messaging ones', async ($, on) => {
  const { seen } = setup(on)
  await start($)
  expect(seen.tools).toEqual(expect.arrayContaining(['stream_updates', 'post_update', 'follow', 'unfollow', 'following', 'followers']))
})

test('stream_updates turns streaming on (with status changes) and off', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await call($, 'stream_updates', { on: true, include_status: true })).toMatch(/Streaming on for cc:happy-dog \(with status changes\)/)
  expect(relay.find('PUT', '/v1/sessions/happy-dog/streaming')[0]?.body).toEqual({ instanceId: 'inst-dog', on: true, includeStatus: true })
  expect(await call($, 'stream_updates', { on: false })).toMatch(/Streaming off for cc:happy-dog.*follows stay/)
  expect(relay.find('PUT', '/v1/sessions/happy-dog/streaming')[1]?.body).toEqual({ instanceId: 'inst-dog', on: false })
})

test('post_update posts once streaming is on, and says why not before', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await call($, 'post_update', { text: 'tests green' })).toMatch(/Not posted: this session is not streaming.*stream_updates/)
  await call($, 'stream_updates', { on: true })
  expect(await call($, 'post_update', { text: 'tests green' })).toMatch(/Posted update 1 /)
  expect(relay.find('POST', '/v1/updates').at(-1)?.body).toEqual({ from: 'happy-dog', instanceId: 'inst-dog', text: 'tests green' })
})

test('post_update checks the length first and explains the hourly limit', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await call($, 'post_update', { text: '  ' })).toMatch(/Not posted: an update is 1–2000 characters/)
  expect(await call($, 'post_update', { text: 'x'.repeat(2001) })).toMatch(/1–2000 characters/)
  expect(relay.find('POST', '/v1/updates')).toHaveLength(0)
  relay.override('POST /v1/updates', { status: 429, body: { error: 'rate_limited' } })
  expect(await call($, 'post_update', { text: 'again' })).toMatch(/Not posted: at most 60 updates an hour/)
})

test('follow follows an agent that streams, and unfollow stops', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await call($, 'follow', { to: 'cc:happy-cat' })).toMatch(/Following cc:happy-cat\. Its updates come with your next prompts, as data/)
  expect(relay.find('PUT', '/v1/follows')[0]?.body).toEqual({ from: 'happy-dog', instanceId: 'inst-dog', to: 'cc:happy-cat' })
  expect(await call($, 'unfollow', { to: 'happy-cat' })).toMatch(/No longer following cc:happy-cat/)
  expect(relay.find('DELETE', '/v1/follows')[0]?.body).toEqual({ from: 'happy-dog', instanceId: 'inst-dog', to: 'happy-cat' })
  expect(await call($, 'follow', { to: 'not an address!' })).toMatch(/is not an address/)
})

const REFUSALS: Array<[number, Record<string, unknown>, RegExp]> = [
  [400, { error: 'invalid_request' }, /an agent cannot follow itself/],
  [404, { error: 'unknown_address' }, /no agent is called cc:api@acme/],
  [403, { error: 'not_shared' }, /this session is not shared in acme/],
  [403, { error: 'denied_by_policy' }, /the policy of acme does not allow updates from cc:api@acme/],
  [403, { error: 'blocked_by_publisher' }, /cc:api@acme removed this session from its followers/],
  [403, { error: 'not_allowed_for_assistant', message: 'Outside reach.' }, /Outside reach\./],
  [409, { error: 'not_streaming', hint: 'x' }, /cc:api@acme is not streaming updates/],
  [409, { error: 'follow_limit', max: 50 }, /at most 50/],
  [429, { error: 'rate_limited' }, /too many follow changes in the last hour/],
  [500, { error: 'internal' }, /the relay answered 500 internal/]
]

test('a refused follow is explained in a plain sentence', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  for (const [status, body, text] of REFUSALS) {
    relay.override('PUT /v1/follows', { status, body })
    const answer = await call($, 'follow', { to: 'cc:api@acme' })
    expect(answer).toMatch(/^Not following: /)
    expect(answer).toMatch(text)
  }
})

test('following lists the follows, marking those paused', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await call($, 'following')).toMatch(/This session follows no agents/)
  relay.streams.follow('cc:happy-cat')
  relay.streams.follow('cc:quiet-owl')
  const text = await call($, 'following')
  expect(text).toMatch(/cc:happy-cat/)
  expect(text).toMatch(/cc:quiet-owl \(paused: not streaming or out of reach\)/)
})

test('followers lists the followers and those removed', async ($, on) => {
  setup(on, SIGNED_IN)
  await start($)
  const text = await call($, 'followers')
  expect(text).toMatch(/Followers of cc:happy-dog:\n- cc:happy-cat/)
  expect(text).toMatch(/Removed \(cannot follow again\):\n- cc:nosy-fox/)
})

test('the stream tools ask to sign in first', async ($, on) => {
  setup(on)
  await start($)
  for (const name of ['stream_updates', 'post_update', 'follow', 'unfollow', 'following', 'followers']) {
    expect(await call($, name, { on: true, text: 'x', to: 'cc:happy-cat' })).toMatch(/\/talkie login/)
  }
})

test('/talkie stream, follow, unfollow and following', async ($, on) => {
  const { relay, seen } = setup(on, SIGNED_IN)
  await start($)
  expect(seen.hints.at(-1)).toMatch(/stream\|follow\|unfollow\|following/)
  expect(await talkie($, 'stream')).toMatch(/Usage: \/talkie stream on\|off/)
  expect(await talkie($, 'stream on --status')).toMatch(/Streaming on for cc:happy-dog \(with status changes\)/)
  expect(relay.find('PUT', '/v1/sessions/happy-dog/streaming')[0]?.body).toEqual({ instanceId: 'inst-dog', on: true, includeStatus: true })
  expect(await talkie($, 'stream off')).toMatch(/Streaming off/)
  expect(await talkie($, 'follow')).toMatch(/Usage: \/talkie follow <address>/)
  expect(await talkie($, 'follow cc:happy-cat')).toMatch(/Following cc:happy-cat/)
  expect(await talkie($, 'following')).toMatch(/cc:happy-cat/)
  expect(await talkie($, 'unfollow cc:happy-cat')).toMatch(/No longer following cc:happy-cat/)
  expect(await talkie($, '')).toMatch(/\/talkie stream on\|off/)
})
