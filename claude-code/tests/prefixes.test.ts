import { expect, test } from 'claude-code/testing'
import { parseTarget } from '../hooks/lib/address.ts'
import { SEND, SIGNED_IN, WHO, setup, start } from './harness.ts'

test('any 2 to 8 character prefix parses; malformed ones do not', () => {
  expect(parseTarget('ws:api')).toEqual({ kind: 'ws', name: 'api', team: null })
  expect(parseTarget('windsurf:api@acme')).toEqual({ kind: 'windsurf', name: 'api', team: 'acme' })
  expect(parseTarget('1x:api')).toBeNull()
  expect(parseTarget('abcdefghi:api')).toBeNull()
})

test('a session claims its name as the claude-code product', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(relay.find('PUT', '/v1/sessions/happy-dog')[0]?.body).toMatchObject({ client: 'claude-code' })
})

test('a message to a new prefix goes to the relay', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  await $.tool.call({ tool: SEND, to: 'ws:review', text: 'hi' })
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'ws:review' })
})

test('who says which account this machine is signed in as', async ($, on) => {
  setup(on, SIGNED_IN)
  await start($)
  expect((await $.tool.call({ tool: WHO })).result).toMatch(/^Signed in as a@x\.io/)
})

test('a send says when the receiver\'s owner was emailed', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: false, ownerNotified: true, to: 'cc:fuzzy-mole', status: 'queued' } })
  await start($)
  expect((await $.tool.call({ tool: SEND, to: 'cc:fuzzy-mole', text: 'merged' })).result).toMatch(/its owner was emailed/i)
})
