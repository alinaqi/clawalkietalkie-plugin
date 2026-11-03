import { expect, test } from 'claude-code/testing'
import { DISCARD_TOOL, SEND_TOOL } from '../hooks/lib/tools.ts'
import { SEND, SIGNED_IN, setup, start } from './harness.ts'

const DISCARD = 'mcp__clawalkietalkie__discard'

type Relay = ReturnType<typeof setup>['relay']
const sends = (relay: Relay) => relay.find('POST', '/v1/messages')

test('the send tool takes the project a message is about, and says to send only where it fits', async () => {
  const props = SEND_TOOL.inputSchema?.properties as Record<string, { type?: string }>
  expect(props.about?.type).toBe('string')
  expect(SEND_TOOL.description).toMatch(/project/i)
  expect(SEND_TOOL.inputSchema?.required).toEqual(['to', 'text'])
})

test('about goes to the relay with the message', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'PR ready', about: 'srooter' })
  expect(sends(relay)[0]?.body).toMatchObject({ about: 'srooter' })
})

test('an unrelated recipient is explained, with the agents on that project', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  relay.override('POST /v1/messages', { status: 409, body: { error: 'unrelated_recipient', project: 'soundingboard', suggest: ['cc:lucky-crane'] } })
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'merge it', about: 'srooter' })
  expect(res.result).toMatch(/Not sent: cc:happy-cat works on soundingboard/)
  expect(res.result).toMatch(/cc:lucky-crane/)
})

test('the conversation guard says to stop and ask the user', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  relay.override('POST /v1/messages', { status: 429, body: { error: 'loop_guard', reason: 'pair_busy' } })
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'again' })
  expect(res.result).toMatch(/going in circles/i)
  expect(res.result).toMatch(/ask the user/i)
})

test('the discard tool drops messages at the relay', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  expect(DISCARD_TOOL.inputSchema?.required).toEqual(['ids'])
  await start($)
  const res = await $.tool.call({ tool: DISCARD, ids: ['m1'] })
  expect(res.result).toMatch(/Discarded 1 message/)
  expect(relay.find('POST', '/v1/inbox/happy-dog/discard')[0]?.body).toEqual({ instanceId: 'inst-dog', ids: ['m1'] })
})

test('an incoming message says to discard it when it is not about this session\'s work', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'merge PR 2184')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).toMatch(/not about this session's work, call discard with ids: \["m1"\]/i)
})

test('a discarded request gets no automatic reply', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'merge PR 2184')
  await start($)
  await clock.advance(1000)
  await $.turn.start({ text: seen.prompts[0]!, turnId: 't1' })
  await $.tool.call({ tool: DISCARD, ids: ['m1'] })
  await $.turn.complete({ answer: 'Not mine.', turnId: 't1', durationMs: 5, isAborted: false, reason: 'answer' })
  expect(sends(relay)).toHaveLength(0)
})
