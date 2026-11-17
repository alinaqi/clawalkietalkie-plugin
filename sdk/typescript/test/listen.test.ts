import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from '../src/index.ts'
import { setup, until } from './helpers.ts'

const listening = async () => {
  const { relay, client } = setup()
  const agent = client.agent({ name: 'bot', client: 'example', instanceId: 'ib' })
  await agent.claim()
  relay.state.sessions.set('cat', { name: 'cat', kind: 'cc', instanceId: 'ic', live: true, closed: false })
  return { relay, agent }
}

const FAST = { waitSeconds: 25, backoff: { minMs: 1, maxMs: 8 }, random: () => 0.5 }

describe('listen', () => {
  it('hands each message to the handler, then acks it', async () => {
    const { relay, agent } = await listening()
    const seen: string[] = []
    let ackedDuringHandler = true
    const stop = agent.listen(async (m) => {
      ackedDuringHandler = relay.callsTo(/ack$/).length > 0
      seen.push(m.text)
    }, FAST)
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'one' })
    await until(() => relay.callsTo(/ack$/).length === 1)
    await stop()
    expect(seen).toEqual(['one'])
    expect(ackedDuringHandler).toBe(false)
    expect(relay.callsTo(/ack$/)[0]!.body).toEqual({ instanceId: 'ib', ids: ['m1'] })
    expect(relay.state.inboxes.get('bot')).toEqual([])
  })

  it('long-polls with the cursor the relay answered', async () => {
    const { relay, agent } = await listening()
    const stop = agent.listen(async () => {}, FAST)
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'one' })
    await until(() => relay.callsTo(/ack$/).length === 1)
    relay.deliver('bot', { id: 'm2', from: 'cc:cat', text: 'two' })
    await until(() => relay.callsTo(/ack$/).length === 2)
    await stop()
    const polls = relay.callsTo(/^\/v1\/inbox\/bot$/)
    expect(polls[0]!.query.get('after')).toBeNull()
    expect(polls[0]!.query.get('wait')).toBe('25')
    expect(polls.at(-1)!.query.get('after')).toMatch(/^c\d+$/)
  })

  it('redelivers a message the handler threw on, and never acks it until it succeeds', async () => {
    const { relay, agent } = await listening()
    const errors: unknown[] = []
    let attempts = 0
    const stop = agent.listen(async () => {
      attempts++
      if (attempts < 3) throw new Error('not yet')
    }, { ...FAST, onError: (e) => { errors.push(e) } })
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'flaky' })
    await until(() => relay.callsTo(/ack$/).length === 1)
    await stop()
    expect(attempts).toBe(3)
    expect(errors).toHaveLength(2)
    expect(relay.callsTo(/ack$/)[0]!.body).toEqual({ instanceId: 'ib', ids: ['m1'] })
  })

  it('backs off on relay errors, doubling to the cap, and resumes', async () => {
    const { relay, agent } = await listening()
    for (let i = 0; i < 5; i++) relay.fail({ path: /^\/v1\/inbox\/bot$/, status: 503, body: { error: 'busy' } })
    const delays: number[] = []
    const seen: string[] = []
    const stop = agent.listen(async (m) => { seen.push(m.id) }, { ...FAST, onError: (_e, info) => { delays.push(info.delayMs) } })
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'x' })
    await until(() => seen.length === 1)
    await stop()
    expect(delays).toEqual([1, 2, 4, 8, 8])
  })

  it('reads from the start when the relay refuses the cursor', async () => {
    const { relay, agent } = await listening()
    const seen: string[] = []
    const stop = agent.listen(async (m) => { seen.push(m.id) }, FAST)
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'x' })
    await until(() => seen.length === 1)
    relay.fail({ path: /^\/v1\/inbox\/bot$/, status: 400, body: { error: 'invalid_request' } })
    relay.deliver('bot', { id: 'm2', from: 'cc:cat', text: 'y' })
    await until(() => seen.length === 2)
    await stop()
    expect(seen).toEqual(['m1', 'm2'])
  })

  it('does not run the handler twice when an ack failed', async () => {
    const { relay, agent } = await listening()
    relay.fail({ path: /ack$/, status: 503, body: { error: 'busy' } })
    const seen: string[] = []
    const stop = agent.listen(async (m) => { seen.push(m.id) }, FAST)
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'x' })
    await until(() => relay.state.inboxes.get('bot')!.length === 0)
    await stop()
    expect(seen).toEqual(['m1'])
  })

  it('replies in the thread and discards, without acking a discarded message', async () => {
    const { relay, agent } = await listening()
    const stop = agent.listen(async (m: IncomingMessage) => {
      if (m.text === 'spam') return m.discard()
      await m.reply(`echo: ${m.text}`)
    }, FAST)
    relay.state.statuses.set('m1', { status: 'queued', replies: [] })
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'hi', hop: 2 })
    relay.deliver('bot', { id: 'm2', from: 'cc:cat', text: 'spam' })
    await until(() => relay.callsTo(/discard$/).length === 1 && relay.callsTo(/ack$/).length === 1)
    await stop()
    const reply = relay.callsTo(/^\/v1\/messages$/)[0]!.body
    expect(reply).toMatchObject({ from: 'bot', to: 'cc:cat', text: 'echo: hi', replyTo: 'm1', hop: 3, type: 'note' })
    expect(relay.callsTo(/discard$/)[0]!.body).toEqual({ instanceId: 'ib', ids: ['m2'] })
    expect(relay.callsTo(/ack$/)[0]!.body).toEqual({ instanceId: 'ib', ids: ['m1'] })
  })

  it('stop() ends a long-poll at once', async () => {
    const { relay, agent } = await listening()
    relay.state.waitScaleMs = 10_000
    const stop = agent.listen(async () => {}, FAST)
    await until(() => relay.callsTo(/^\/v1\/inbox\/bot$/).length === 1)
    const started = Date.now()
    await stop()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('claims first when listening before claiming', async () => {
    const { relay, client } = setup()
    const stop = client.agent({ name: 'late', client: 'example' }).listen(async () => {}, FAST)
    await until(() => relay.callsTo(/^\/v1\/inbox\/late$/).length > 0)
    await stop()
    expect(relay.state.calls[0]!.method).toBe('PUT')
  })

  it('stops for good when the token is no longer valid, saying so', async () => {
    const { relay, agent } = await listening()
    relay.fail({ path: /^\/v1\/inbox\/bot$/, status: 401, body: { error: 'unauthorized' } })
    const infos: Array<{ fatal: boolean }> = []
    const stop = agent.listen(async () => {}, { ...FAST, onError: (_e, info) => { infos.push(info) } })
    await until(() => infos.length === 1)
    await stop()
    expect(infos[0]!.fatal).toBe(true)
    expect(relay.callsTo(/^\/v1\/inbox\/bot$/)).toHaveLength(1)
  })

  it('close() stops listening, then closes the session', async () => {
    const { relay, agent } = await listening()
    agent.listen(async () => {}, FAST)
    await until(() => relay.callsTo(/^\/v1\/inbox\/bot$/).length === 1)
    await agent.close()
    const polls = relay.callsTo(/^\/v1\/inbox\/bot$/).length
    await new Promise((r) => setTimeout(r, 30))
    expect(relay.callsTo(/^\/v1\/inbox\/bot$/)).toHaveLength(polls)
    expect(relay.state.sessions.get('bot')!.closed).toBe(true)
  })

  it('takes a long-poll the network cut after a while as an empty answer, without backing off', async () => {
    const { relay, agent } = await listening()
    relay.fail({ path: /^\/v1\/inbox\/bot$/, status: 0, network: true, afterMs: 30 })
    const errors: unknown[] = []
    const seen: string[] = []
    const stop = agent.listen(async (m) => { seen.push(m.id) }, { ...FAST, cutAfterMs: 20, onError: (e) => { errors.push(e) } })
    await until(() => relay.callsTo(/^\/v1\/inbox\/bot$/).length >= 2)
    relay.deliver('bot', { id: 'm1', from: 'cc:cat', text: 'x' })
    await until(() => seen.length === 1)
    await stop()
    expect(errors).toEqual([])
  })
})
