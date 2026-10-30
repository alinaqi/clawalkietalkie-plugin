import { expect, test } from 'claude-code/testing'
import { SEND, SIGNED_IN, WHO, setup, start, talkie } from './harness.ts'

test('registers /talkie and the send and who tools, and asks to sign in', async ($, on) => {
  const { seen } = setup(on)
  await start($)
  expect(seen.commands).toEqual(['talkie'])
  expect(seen.tools.sort()).toEqual(['send', 'who'])
  expect(seen.statuses.at(-1)).toBe('📻 /talkie login')
})

test('login mails a code, verify signs in and claims an address', async ($, on) => {
  const { relay, seen } = setup(on, { 'session:sess-1': { name: 'happy-dog', instanceId: 'inst-dog' } })
  await start($)
  expect(await talkie($, 'login a@x.io')).toMatch(/Code sent to a@x.io/)
  expect(relay.find('POST', '/v1/auth/otp')[0]?.body).toEqual({ email: 'a@x.io' })
  expect(await talkie($, 'verify 000000')).toMatch(/wrong or expired/)
  expect(await talkie($, 'verify 123456')).toMatch(/Signed in as a@x.io.*cc:happy-dog/s)
  expect(relay.find('PUT', '/v1/sessions/happy-dog')[0]?.body).toMatchObject({ instanceId: 'inst-dog', cwd: 'web' })
  expect(seen.statuses.at(-1)).toBe('📻 cc:happy-dog')
})

test('verify still works after the mod restarts between login and verify', async ($, on) => {
  setup(on)
  await start($)
  await talkie($, 'login a@x.io')
  await start($)
  expect(await talkie($, 'verify 123456')).toMatch(/Signed in as a@x.io/)
})

test('/talkie name renames, and says when the name is taken', async ($, on) => {
  const { relay, seen } = setup(on, SIGNED_IN)
  await start($)
  relay.take('busy-bee')
  expect(await talkie($, 'name busy-bee')).toMatch(/cc:busy-bee is taken/)
  expect(await talkie($, 'name Brave-Fox')).toMatch(/now cc:brave-fox/)
  expect(relay.find('DELETE', '/v1/sessions/happy-dog')).toHaveLength(1)
  expect(seen.statuses.at(-1)).toBe('📻 cc:brave-fox')
})

test('a 401 while polling signs out and stops listening', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.override('GET /v1/inbox/happy-dog', { status: 401, body: { error: 'unauthorized' } })
  await start($)
  await clock.advance(1000)
  const polls = relay.find('GET', '/v1/inbox').length
  await clock.advance(60_000)
  expect(relay.find('GET', '/v1/inbox')).toHaveLength(polls)
  expect(seen.statuses.at(-1)).toBe('📻 /talkie login')
})

test('logout revokes the token and forgets it', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'logout')).toMatch(/Signed out/)
  expect(relay.find('DELETE', '/v1/auth/token')).toHaveLength(1)
  expect(await talkie($, 'status')).toMatch(/Account: not signed in/)
  expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x' })).result).toMatch(/\/talkie login/)
})

test('a stored sign-in survives into the next session', async ($, on) => {
  const { relay } = setup(on, { auth: SIGNED_IN.auth })
  await start($)
  const claimed = relay.find('PUT', '/v1/sessions/')
  expect(claimed).toHaveLength(1)
  expect(claimed[0]?.path).toMatch(/^\/v1\/sessions\/[a-z]+-[a-z]+$/)
})

test('a name another live session holds is swapped for a fresh one at start', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  relay.take('happy-dog')
  await start($)
  const claimed = relay.find('PUT', '/v1/sessions/').map((c) => c.path)
  expect(claimed[0]).toBe('/v1/sessions/happy-dog')
  expect(claimed[1]).not.toBe('/v1/sessions/happy-dog')
})

test('relay errors while polling back off and recover', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.override('GET /v1/inbox/happy-dog', { status: 503, body: { error: 'down' } })
  await start($)
  await clock.advance(10)
  expect(relay.find('GET', '/v1/inbox')).toHaveLength(1)
  await clock.advance(500)
  expect(relay.find('GET', '/v1/inbox')).toHaveLength(1)
  relay.override('GET /v1/inbox/happy-dog', { status: 200, body: { messages: [{ id: 'x1', from: 'cc:happy-cat', text: 'back', sentAt: 0 }] } })
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(1)
})

test('session end gives the name back', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } as never })
  expect(relay.find('DELETE', '/v1/sessions/happy-dog')[0]?.body).toEqual({ instanceId: 'inst-dog' })
})

test('/talkie with no arguments shows help', async ($, on) => {
  setup(on)
  await start($)
  expect(await talkie($, '')).toMatch(/\/talkie login <email>/)
})

test('talks to the hosted relay unless serverUrl says otherwise', async ($, on) => {
  setup(on)
  await start($)
  expect(await talkie($, 'status')).toMatch(/Relay: https:\/\/clawalkietalkie-relay\.onrender\.com/)
})

test('a message the person sends by hand always starts a fresh chain', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'status?', 1)
  await start($)
  await clock.advance(1000)
  await talkie($, 'send cc:happy-cat a new question')
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ hop: 0 })
})
