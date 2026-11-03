import { expect, test } from 'claude-code/testing'
import { SEND_TOOL } from '../hooks/lib/tools.ts'
import { SEND, SIGNED_IN, setup, start, talkie } from './harness.ts'

type Relay = ReturnType<typeof setup>['relay']
const bodies = (relay: Relay) => relay.find('POST', '/v1/messages').map((c) => c.body)

test('the send tool offers an optional reply_to', async () => {
  const props = SEND_TOOL.inputSchema?.properties as Record<string, { type?: string, description?: string }>
  expect(props.reply_to?.type).toBe('string')
  expect(props.reply_to?.description).toMatch(/id of the message/i)
  expect(SEND_TOOL.inputSchema?.required).toEqual(['to', 'text'])
})

test('the send tool threads a message under the one it answers', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'status?')
  await start($)
  await clock.advance(1000)
  expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'green', reply_to: 'm1' })).result).toMatch(/Sent to cc:happy-cat/)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'unthreaded' })
  expect(bodies(relay)[0]).toMatchObject({ replyTo: 'm1', hop: 1 })
  expect(bodies(relay)[1]).not.toHaveProperty('replyTo')
})

test('a reply_to the relay refuses is explained', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x', reply_to: 'nope' })
  expect(res.result).toMatch(/Not sent: nope is not a message this session received from cc:happy-cat/)
  expect(bodies(relay)[0]).toMatchObject({ replyTo: 'nope' })
})

test('/talkie send and ask take --reply-to <id> after the address', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'status?')
  relay.deliver('cc:happy-cat', 'and the logs?')
  await start($)
  await clock.advance(1000)
  expect(await talkie($, 'send cc:happy-cat --reply-to m1 all green')).toMatch(/Sent to cc:happy-cat/)
  expect(await talkie($, 'ask cc:happy-cat --reply-to=m2 please send them')).toMatch(/Sent to cc:happy-cat/)
  expect(await talkie($, 'send cc:happy-cat --reply-to m1')).toMatch(/Usage: \/talkie send/)
  expect(bodies(relay)).toMatchObject([
    { text: 'all green', replyTo: 'm1', type: 'note', hop: 0 },
    { text: 'please send them', replyTo: 'm2', type: 'request', hop: 0 }
  ])
})

test('help lists --reply-to', async ($, on) => {
  setup(on)
  await start($)
  expect(await talkie($, '')).toMatch(/--reply-to <id>/)
})
