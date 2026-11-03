import { expect, test } from 'claude-code/testing'
import { jitter, nextBackoff } from '../hooks/lib/backoff.ts'
import { SIGNED_IN, setup, start } from './harness.ts'

type Relay = ReturnType<typeof setup>['relay']
const polls = (relay: Relay) => relay.find('GET', '/v1/inbox/').map((c) => new URLSearchParams(c.path.split('?')[1]).get('after'))
const END = { reason: 'prompt_input_exit', sessionId: 'sess-1', resume: { sessionId: 'sess-1' } as never } as const

test('the listener polls on from the cursor the relay handed it', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'one')
  await start($)
  await clock.advance(300)
  relay.deliver('cc:happy-cat', 'two')
  await clock.advance(300)
  expect(polls(relay).slice(0, 2)).toEqual([null, 'c1'])
  expect(seen.prompts).toHaveLength(2)
  expect(relay.waiting()).toBe(0)
})

test('the cursor is kept in the store, and a restarted session resumes from it', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'one')
  await start($)
  await clock.advance(300)
  await $.session.end(END)
  await start($)
  await clock.advance(10)
  expect(polls(relay).at(-1)).toBe('c1')
})

test('a stored cursor the relay rejects is dropped, and polling starts over without one', async ($, on) => {
  const { relay, seen, clock } = setup(on, { ...SIGNED_IN, 'cursor:happy-dog:inst-dog': 'stale!' })
  relay.deliver('cc:happy-cat', 'still here')
  await start($)
  await clock.advance(300)
  expect(polls(relay).slice(0, 2)).toEqual(['stale!', null])
  expect(seen.prompts).toHaveLength(1)
})

test('after relay errors the listener reconnects from the saved cursor', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'one')
  await start($)
  await clock.advance(300)
  relay.override('GET /v1/inbox/happy-dog', { status: 503, body: { error: 'down' } })
  await clock.advance(5000)
  relay.restore('GET /v1/inbox/happy-dog')
  await clock.advance(40_000)
  expect(polls(relay).every((after, i) => i === 0 || after === 'c1')).toBe(true)
  expect(polls(relay).length).toBeGreaterThan(3)
})

test('a renamed session drops the old name\'s cursor', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:happy-cat', 'one')
  await start($)
  await clock.advance(300)
  await $.command.run({ command: 'talkie', args: 'name brave-fox', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await clock.advance(10)
  expect(polls(relay).at(-1)).toBe(null)
})

test('jitter keeps a wait within 20% either side', async () => {
  expect(jitter(1000, () => 0)).toBe(800)
  expect(jitter(1000, () => 0.5)).toBe(1000)
  expect(jitter(1000, () => 0.999999)).toBeLessThan(1200)
  for (let i = 0; i < 200; i++) {
    const ms = jitter(10_000, Math.random)
    expect(ms >= 8000 && ms < 12_000).toBe(true)
  }
})

test('the backoff doubles from 1 s up to its cap', async () => {
  expect(nextBackoff(0, 30_000)).toBe(1000)
  expect(nextBackoff(1000, 30_000)).toBe(2000)
  expect(nextBackoff(20_000, 30_000)).toBe(30_000)
})
