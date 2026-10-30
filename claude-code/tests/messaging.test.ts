import { expect, test } from 'claude-code/testing'
import { SEND, SIGNED_IN, WHO, setup, start, talkie } from './harness.ts'

test('an incoming message is submitted as a framed prompt and acked', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'what is the build status?')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('cc:happy-cat')
  expect(seen.prompts[0]).toContain('what is the build status?')
  expect(seen.toasts.at(-1)).toMatch(/cc:happy-cat/)
  expect(relay.find('POST', '/v1/inbox/happy-dog/ack')[0]?.body).toEqual({ instanceId: 'inst-dog', ids: ['m1'] })
})

test('the send tool sends from this session and reports delivery', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'build is green' })
  expect(res.result).toMatch(/Sent to cc:happy-cat/)
  expect(relay.find('POST', '/v1/messages')[0]?.body).toEqual({ from: 'happy-dog', instanceId: 'inst-dog', to: 'cc:happy-cat', text: 'build is green', hop: 0 })
})

test('the send tool refuses a bad address and an unknown one', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect((await $.tool.call({ tool: SEND, to: 'not valid!', text: 'x' })).result).toMatch(/not an address/)
  relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
  expect((await $.tool.call({ tool: SEND, to: 'cc:ghost', text: 'x' })).result).toMatch(/No session is called cc:ghost/)
})

test('the send tool asks to sign in when signed out', async ($, on) => {
  setup(on)
  await start($)
  expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x' })).result).toMatch(/\/talkie login/)
})

test('who lists the account sessions, for the person and the model', async ($, on) => {
  setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'who')).toMatch(/cc:happy-cat/)
  expect((await $.tool.call({ tool: WHO })).result).toMatch(/cc:happy-cat/)
})

test('/talkie send sends a message', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'send cc:happy-cat hello there')).toMatch(/Sent to cc:happy-cat/)
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'cc:happy-cat', text: 'hello there' })
})

test('/talkie off stops delivery and /talkie on resumes it', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'off')).toMatch(/stopped/)
  relay.deliver('cc:happy-cat', 'hello?')
  await clock.advance(5000)
  expect(seen.prompts).toHaveLength(0)
  expect(await talkie($, 'on')).toMatch(/Listening/)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(1)
})

test('with autoDeliver off, messages are toasts held for /talkie inbox', { options: { autoDeliver: false } }, async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'quiet please')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(0)
  expect(seen.toasts.at(-1)).toMatch(/quiet please/)
  expect(await talkie($, 'inbox')).toMatch(/quiet please/)
  expect(await talkie($, 'inbox')).toBe('No held messages.')
})

test('an unknown address that is close to a real one gets a suggestion', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
  expect(await talkie($, 'send cc:hapy-cat hi')).toMatch(/No session is called cc:hapy-cat\. Did you mean cc:happy-cat\?/)
  expect((await $.tool.call({ tool: SEND, to: 'cc:zzz', text: 'x' })).result).not.toMatch(/Did you mean/)
})

test('an answer to a message is sent one hop deeper', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'status?')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(1)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'all green' })
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ hop: 1 })
})

test('a reply is delivered marked as one, and an answer to it goes at hop 2', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'all green', 1)
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).toMatch(/a reply/)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'thanks' })
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ hop: 2 })
})

test('a reply to a reply starts no turn: it is a toast held for /talkie inbox', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'thanks', 2)
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(0)
  expect(seen.toasts.at(-1)).toMatch(/thanks/)
  expect(await talkie($, 'inbox')).toMatch(/thanks/)
  expect(relay.find('POST', '/v1/inbox/happy-dog/ack')).toHaveLength(1)
})

test('sends to another kind of agent by its prefix, and names it as the relay resolved it', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: true, to: 'cx:review-bot' } })
  expect((await $.tool.call({ tool: SEND, to: 'cx:review-bot', text: 'review PR 12' })).result).toMatch(/Sent to cx:review-bot/)
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'cx:review-bot' })
  expect(await talkie($, 'send review-bot hi')).toMatch(/Sent to cx:review-bot/)
})

test('a wrong prefix suggests the agent that holds the name', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
  relay.override('GET /v1/sessions', { status: 200, body: { sessions: [{ address: 'cx:review-bot', online: true, lastSeen: 0, host: null, cwd: null }] } })
  expect(await talkie($, 'send cc:review-bot hi')).toMatch(/Did you mean cx:review-bot\?/)
})

test('an unknown prefix is not an address', async ($, on) => {
  setup(on, SIGNED_IN)
  await start($)
  expect((await $.tool.call({ tool: SEND, to: 'zz:review-bot', text: 'x' })).result).toMatch(/not an address/)
})
