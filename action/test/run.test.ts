import { describe, expect, it } from 'vitest'
import { readInputs } from '../src/inputs.ts'
import { run } from '../src/run.ts'
import { fakeRelay } from './fake-relay.ts'

const inputs = { key: 'cwk_secret', to: 'cx:fixer@acme', text: 'Build 41 failed', server: 'https://relay.test', waitSeconds: 0 }

describe('readInputs', () => {
  it('reads the INPUT_ variables GitHub sets', () => {
    const env = { INPUT_KEY: 'cwk_x', INPUT_TO: 'cx:fixer@acme', INPUT_TEXT: 'hi', INPUT_SERVER: '', INPUT_WAIT_SECONDS: '30' }
    expect(readInputs(env)).toEqual({ key: 'cwk_x', to: 'cx:fixer@acme', text: 'hi', server: 'https://clawalkietalkie-relay.onrender.com', waitSeconds: 30 })
  })

  it('refuses a missing key, address or text, and a key that is not a team key', () => {
    expect(() => readInputs({ INPUT_TO: 'a', INPUT_TEXT: 'b' })).toThrow('key')
    expect(() => readInputs({ INPUT_KEY: 'cwk_x', INPUT_TEXT: 'b' })).toThrow('to')
    expect(() => readInputs({ INPUT_KEY: 'cwk_x', INPUT_TO: 'a' })).toThrow('text')
    expect(() => readInputs({ INPUT_KEY: 'personal', INPUT_TO: 'a', INPUT_TEXT: 'b' })).toThrow('cwk_')
  })

  it('caps the wait at an hour', () => {
    expect(readInputs({ INPUT_KEY: 'cwk_x', INPUT_TO: 'a', INPUT_TEXT: 'b', INPUT_WAIT_SECONDS: '99999' }).waitSeconds).toBe(3600)
  })
})

describe('run', () => {
  it('claims the key\'s agent and sends as it with the key', async () => {
    const relay = fakeRelay()
    const out = await run({ inputs, fetch: relay.fetch, now: () => 0 })
    expect(out).toEqual({ id: 'm1', to: 'cx:fixer@acme', delivery: 'prompt', from: 'gh:ci@acme' })
    const sent = relay.calls.find((c) => c.path === '/v1/messages')!
    expect(sent.body).toMatchObject({ from: 'ci', to: 'cx:fixer@acme', text: 'Build 41 failed', hop: 0 })
    expect(sent.auth).toBe('Bearer cwk_secret')
    expect(relay.calls.find((c) => c.path === '/v1/sessions/ci')!.body).toMatchObject({ kind: 'gh' })
  })

  it('waits for a reply from the address it wrote to, and acks what it read', async () => {
    const relay = fakeRelay([{ from: 'cc:other@acme', text: 'not me' }, { from: 'cx:fixer@acme', text: 'Fixed in #43' }])
    let time = 0
    const out = await run({ inputs: { ...inputs, waitSeconds: 60 }, fetch: relay.fetch, now: () => (time += 1000) })
    expect(out.reply).toBe('Fixed in #43')
    expect(relay.calls.find((c) => c.path === '/v1/inbox/ci/ack')!.body).toMatchObject({ ids: ['r0', 'r1'] })
  })

  it('drains messages from earlier runs before sending, so a late old reply is not taken as this run\'s', async () => {
    const relay = fakeRelay([{ from: 'cx:fixer@acme', text: 'Fresh answer' }], [{ from: 'cx:fixer@acme', text: 'Answer to the previous run' }])
    let time = 0
    const out = await run({ inputs: { ...inputs, waitSeconds: 60 }, fetch: relay.fetch, now: () => (time += 1000) })
    expect(out.reply).toBe('Fresh answer')
    const order = relay.calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)
    expect(order.indexOf('POST /v1/inbox/ci/ack')).toBeLessThan(order.indexOf('POST /v1/messages'))
  })

  it('reports the status when the relay answers with a non-JSON error', async () => {
    const relay = fakeRelay()
    await expect(run({ inputs: { ...inputs, server: 'https://relay.test/text-error' }, fetch: relay.fetch, now: () => 0 })).rejects.toThrow('502')
  })

  it('says plainly when a newer run with the same key took over', async () => {
    const relay = fakeRelay([], [], 2)
    let time = 0
    await expect(run({ inputs: { ...inputs, waitSeconds: 60 }, fetch: relay.fetch, now: () => (time += 1000) })).rejects.toThrow('newer run')
  })

  it('gives up waiting at the deadline', async () => {
    const relay = fakeRelay()
    let time = 0
    const out = await run({ inputs: { ...inputs, waitSeconds: 60 }, fetch: relay.fetch, now: () => (time += 30_000) })
    expect(out.reply).toBeUndefined()
  })

  it('fails with the relay\'s error code', async () => {
    const relay = fakeRelay()
    await expect(run({ inputs: { ...inputs, server: 'https://relay.test/nowhere' }, fetch: relay.fetch, now: () => 0 })).rejects.toThrow('404')
  })
})
