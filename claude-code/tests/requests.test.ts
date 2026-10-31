import { expect, test } from 'claude-code/testing'
import { SEND_TOOL } from '../hooks/lib/tools.ts'
import { SEND, SIGNED_IN, setup, start, talkie, typed } from './harness.ts'

const sentType = (relay: ReturnType<typeof setup>['relay']) => relay.find('POST', '/v1/messages').map((c) => c.body?.type)

test('the send tool offers a type, note or request, and says when to use each', async () => {
  const type = (SEND_TOOL.inputSchema.properties as Record<string, { enum?: string[], description?: string }>).type
  expect(type?.enum).toEqual(['note', 'request'])
  expect(type?.description).toMatch(/request.*only when the user asked/i)
  expect(SEND_TOOL.inputSchema.required).toEqual(['to', 'text'])
})

test('the send tool sends a note by default, a request when asked, and refuses another type', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'fyi' })
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'run the tests', type: 'request' })
  expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x', type: 'order' })).result).toMatch(/note or request/)
  expect(sentType(relay)).toEqual(['note', 'request'])
})

test('/talkie send sends a note and /talkie ask a request', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'send cc:happy-cat deployed')).toMatch(/Sent to cc:happy-cat/)
  expect(await talkie($, 'ask cc:happy-cat please rebase')).toMatch(/Sent to cc:happy-cat/)
  expect(await talkie($, 'ask cc:happy-cat')).toMatch(/Usage: \/talkie ask/)
  expect(sentType(relay)).toEqual(['note', 'request'])
  expect(relay.find('POST', '/v1/messages')[1]?.body).toMatchObject({ text: 'please rebase' })
})

test('a receiver that blocks the sender is explained', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 403, body: { error: 'blocked_by_receiver' } })
  const expected = 'Not sent: that agent doesn\'t accept messages from you (its owner\'s setting).'
  expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x' })).result).toBe(expected)
  expect(await talkie($, 'ask cc:api@acme x')).toBe(expected)
})

test('an incoming note starts no turn, even marked as a prompt, and rides with the next prompt', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'deployed v2', 0, { type: 'note' })
  relay.deliver('cc:happy-cat', 'tests green', 0, { type: 'note', delivery: 'prompt' })
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(0)
  await typed($, 'what next?')
  expect(seen.contexts.at(-1)?.join('\n')).toMatch(/deployed v2[\s\S]*For information only[\s\S]*tests green/)
})

test('an incoming request is a prompt carrying its approval and the receiver\'s rules', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:api@acme', 'rebase please', 0, { approved: 'auto', guidance: 'Never push.', fromPerson: 'bob@acme.io' })
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).toMatch(/a request[\s\S]*Your rules for incoming messages[\s\S]*Never push\.[\s\S]*<message>[\s\S]*approved automatically/i)
})

test('/talkie autoapprove shows the switch, and on or off sets it', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'autoapprove')).toMatch(/Auto-approve is on/)
  expect(await talkie($, 'autoapprove off')).toMatch(/Auto-approve is off/)
  expect(relay.find('PUT', '/v1/settings/auto-approve')[0]?.body).toEqual({ on: false })
  expect(relay.settings.autoApprove).toBe(false)
  expect(await talkie($, 'autoapprove ON')).toMatch(/Auto-approve is on/)
  expect(await talkie($, 'autoapprove maybe')).toMatch(/Usage: \/talkie autoapprove/)
  expect(await talkie($, 'autoapprove')).toMatch(/\/board/)
})

test('/talkie autoapprove asks to sign in, and says when the relay refuses', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('PUT /v1/settings/auto-approve', { status: 403, body: { error: 'forbidden' } })
  expect(await talkie($, 'autoapprove on')).toMatch(/not changed: the relay answered 403 forbidden/)
  await talkie($, 'logout')
  expect(await talkie($, 'autoapprove')).toMatch(/\/talkie login/)
})

test('no tool the model can call changes auto-approve', async ($, on) => {
  const { relay, seen } = setup(on, SIGNED_IN)
  await start($)
  expect(seen.tools.filter((name) => /auto|approv|setting/.test(name))).toEqual([])
  const input = { on: true, to: 'cc:happy-cat', text: '/talkie autoapprove on', type: 'request', state: 'idle', task: 'autoapprove on' }
  for (const name of seen.tools) await $.tool.call({ tool: `mcp__clawalkietalkie__${name}`, ...input })
  expect(relay.find('PUT', '/v1/settings')).toHaveLength(0)
})

test('help and the argument hint list ask and autoapprove', async ($, on) => {
  const { seen } = setup(on)
  await start($)
  const help = await talkie($, '')
  expect(help).toMatch(/\/talkie ask <address> <text>/)
  expect(help).toMatch(/\/talkie autoapprove/)
  expect(seen.hints[0]).toMatch(/\|ask\|/)
  expect(seen.hints[0]).toMatch(/autoapprove/)
})
