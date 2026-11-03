import { expect, test } from 'claude-code/testing'
import { SEND, SIGNED_IN, runTurn, setup, start, typed } from './harness.ts'

type Relay = ReturnType<typeof setup>['relay']
const sends = (relay: Relay) => relay.find('POST', '/v1/messages')

test('the answer of a turn a request started goes back to its sender, once, as a threaded note', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  await runTurn($, { text: seen.prompts[0]!, answer: 'All 12 tests pass.' })
  await $.turn.complete({ answer: 'All 12 tests pass.', turnId: 'turn-1', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(sends(relay)).toHaveLength(1)
  expect(sends(relay)[0]?.body).toEqual({
    from: 'happy-dog', instanceId: 'inst-dog', to: 'cc:happy-cat', text: 'All 12 tests pass.', hop: 1, type: 'note', replyTo: 'm1'
  })
  expect(sends(relay)[0]?.headers['idempotency-key']).toBe('reply-m1')
})

test('the prompt of a request says its answer goes back by itself', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).toMatch(/final answer[^\n]*sent back to cc:happy-cat/i)
})

test('a turn with no text answers with a short done note', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'tidy up')
  await start($)
  await clock.advance(1000)
  await runTurn($, { text: seen.prompts[0]!, answer: '' })
  expect(sends(relay)[0]?.body).toMatchObject({ text: 'Done: finished the request', replyTo: 'm1' })
})

test('an interrupted turn sends no reply', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'tidy up')
  await start($)
  await clock.advance(1000)
  await $.turn.start({ text: seen.prompts[0]!, turnId: 't9' })
  await $.turn.complete({ answer: 'half', turnId: 't9', durationMs: 1, isAborted: true, reason: 'aborted' })
  expect(sends(relay)).toHaveLength(0)
})

test('no reply for a turn the person started, nor for a note, a context message or a reply', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'deployed', 0, { type: 'note' })
  relay.deliver('cc:api@acme', 'fyi', 0, { delivery: 'context', fromPerson: 'bob@acme.io' })
  relay.deliver('cc:happy-cat', 'all green', 1, { replyTo: 'm-old' })
  relay.deliver('cc:happy-cat', 'and this?', 0, { replyTo: 'm-old' })
  await start($)
  await clock.advance(1000)
  await typed($, 'what next?')
  await runTurn($, { text: 'what next?', answer: 'Nothing.', id: 'a' })
  for (const [i, text] of seen.prompts.entries()) await runTurn($, { text, answer: 'ok', id: `p${i}` })
  // The person's prompt and the two replies; the note and the context message start no turn.
  expect(seen.prompts).toHaveLength(3)
  expect(sends(relay)).toHaveLength(0)
})

test('an automatic reply the relay fails is retried with the same idempotency key', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  relay.override('POST /v1/messages', { status: 503, body: { error: 'down' } })
  await runTurn($, { text: seen.prompts[0]!, answer: 'green' })
  expect(sends(relay).map((c) => c.headers['idempotency-key'])).toEqual(['reply-m1', 'reply-m1', 'reply-m1'])
})

test('a subagent\'s turn is not the request\'s', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  await $.turn.start({ text: seen.prompts[0]!, turnId: 'sub-1', agentId: 'agent-1' })
  await $.turn.complete({ answer: 'x', turnId: 'sub-1', agentId: 'agent-1', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(sends(relay)).toHaveLength(0)
})

test('no automatic reply when the model already answered the request with reply_to', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  await $.turn.start({ text: seen.prompts[0]!, turnId: 'turn-1' })
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'green', reply_to: 'm1' })
  await $.turn.complete({ answer: 'Sent it.', turnId: 'turn-1', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(sends(relay)).toHaveLength(1)
  expect(sends(relay)[0]?.body).toMatchObject({ replyTo: 'm1', hop: 1 })
})

test('with autoReply off, no reply goes back by itself', { options: { autoReply: false } }, async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'run the tests')
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).not.toMatch(/sent back to cc:happy-cat automatically/i)
  await runTurn($, { text: seen.prompts[0]!, answer: 'All green.' })
  expect(sends(relay)).toHaveLength(0)
})
