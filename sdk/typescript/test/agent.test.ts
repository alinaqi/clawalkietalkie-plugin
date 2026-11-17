import { describe, expect, it } from 'vitest'
import { ClawalkietalkieError } from '../src/index.ts'
import { setup } from './helpers.ts'

describe('claiming an address', () => {
  it('claims the name with the product, label and place, and answers the address', async () => {
    const { relay, client } = setup()
    const agent = client.agent({ name: 'bot', client: 'acme-bot', label: 'Acme Bot', cwd: 'web', instanceId: 'i1' })
    expect(await agent.claim()).toBe('ac:bot')
    expect(agent.address).toBe('ac:bot')
    expect(relay.state.calls[0]!.body).toEqual({ instanceId: 'i1', client: 'acme-bot', label: 'Acme Bot', cwd: 'web' })
  })

  it('generates a name when none is given, and a fresh one when it is taken', async () => {
    const { relay, client } = setup()
    relay.fail({ path: /^\/v1\/sessions\//, method: 'PUT', status: 409, body: { error: 'name_taken' } })
    const agent = client.agent({ client: 'acme-bot' })
    const address = await agent.claim()
    expect(address).toMatch(/^ac:[a-z]+-[a-z]+$/)
    expect(relay.callsTo(/^\/v1\/sessions\//, 'PUT')).toHaveLength(2)
    expect(agent.instanceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('explains a taken name it was asked for', async () => {
    const { relay, client } = setup()
    relay.state.sessions.set('bot', { name: 'bot', kind: 'cc', instanceId: 'other', live: true, closed: false })
    const error = await client.agent({ name: 'bot', client: 'acme-bot' }).claim().catch((e: unknown) => e) as ClawalkietalkieError
    expect(error.code).toBe('name_taken')
    expect(error.message).toMatch(/bot.*another live agent/)
  })

  it('refuses a name that is not an address before calling the relay', () => {
    const { client } = setup()
    expect(() => client.agent({ name: 'Not A Name!', client: 'x1' })).toThrow(/not a valid name/)
  })
})

describe('sending', () => {
  const pair = async () => {
    const { relay, client } = setup()
    const a = client.agent({ name: 'a', client: 'example', instanceId: 'ia' })
    const b = client.agent({ name: 'b', client: 'example', instanceId: 'ib' })
    await a.claim()
    await b.claim()
    return { relay, a, b }
  }

  it('sends a request with an Idempotency-Key and answers what the relay said', async () => {
    const { relay, a } = await pair()
    const sent = await a.send('ex:b', 'hi', { type: 'request', about: 'web' })
    expect(sent).toMatchObject({ id: 'm1', status: 'queued', online: true, to: 'ex:b' })
    const call = relay.callsTo(/^\/v1\/messages$/)[0]!
    expect(call.body).toEqual({ from: 'a', instanceId: 'ia', to: 'ex:b', text: 'hi', type: 'request', about: 'web' })
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('claims first when the agent has not', async () => {
    const { client, relay } = setup()
    relay.state.sessions.set('b', { name: 'b', kind: 'ex', instanceId: 'x', live: true, closed: false })
    await client.agent({ name: 'a', client: 'example' }).send('b', 'hi')
    expect(relay.state.calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
  })

  it('retries a 5xx or a network failure with the same key, and sends once', async () => {
    const { relay, a } = await pair()
    relay.fail({ path: /^\/v1\/messages$/, status: 503, body: { error: 'busy' } })
    relay.fail({ path: /^\/v1\/messages$/, status: 0, network: true })
    const sent = await a.send('b', 'hi')
    const keys = relay.callsTo(/^\/v1\/messages$/).map((c) => c.headers['idempotency-key'])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
    expect(sent.id).toBe('m1')
    expect(relay.state.inboxes.get('b')).toHaveLength(1)
  })

  it('does not retry a refusal, and types it', async () => {
    const { relay, a } = await pair()
    relay.fail({ path: /^\/v1\/messages$/, status: 409, body: { error: 'unrelated_recipient', project: 'api', suggest: ['cc:api'] } })
    const error = await a.send('b', 'hi', { about: 'web' }).catch((e: unknown) => e) as ClawalkietalkieError
    expect(error).toMatchObject({ code: 'unrelated_recipient', project: 'api', suggest: ['cc:api'] })
    expect(relay.callsTo(/^\/v1\/messages$/)).toHaveLength(1)
    await expect(a.send('nobody', 'hi')).rejects.toMatchObject({ code: 'unknown_address', status: 404 })
  })

  it('refuses an address that cannot be one, and a bad type', async () => {
    const { a } = await pair()
    await expect(a.send('Bad Address', 'hi')).rejects.toMatchObject({ code: 'invalid_address' })
    await expect(a.send('b', 'hi', { type: 'order' as 'note' })).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('reads the status and waits for a reply', async () => {
    const { relay, a, b } = await pair()
    const sent = await a.send('b', 'ping', { type: 'request' })
    expect(await a.status(sent.id)).toMatchObject({ id: sent.id, status: 'queued', replies: [] })
    setTimeout(() => { void b.send('a', 'pong', { replyTo: sent.id }) }, 20)
    const answer = await a.waitForReply(sent.id, { timeoutMs: 2000 })
    expect(answer).toMatchObject({ status: 'replied', timedOut: false, replies: [{ text: 'pong', from: 'ex:b' }] })
    expect(Number(relay.callsTo(/^\/v1\/replies$/)[0]!.query.get('wait'))).toBeLessThanOrEqual(50)
  })

  it('keeps waiting when the network cuts a long reply poll', async () => {
    const { relay, a } = await pair()
    const sent = await a.send('b', 'ping')
    relay.fail({ path: /^\/v1\/replies$/, status: 0, network: true, afterMs: 30 })
    expect(await a.waitForReply(sent.id, { timeoutMs: 1500, cutAfterMs: 20 })).toMatchObject({ timedOut: true })
    expect(relay.callsTo(/^\/v1\/replies$/).length).toBeGreaterThan(1)
  })

  it('stops waiting at the timeout with no reply', async () => {
    const { a } = await pair()
    const sent = await a.send('b', 'ping')
    expect(await a.waitForReply(sent.id, { timeoutMs: 30 })).toMatchObject({ replies: [], timedOut: true, status: 'queued' })
  })
})

describe('status and closing', () => {
  it('sets a status and closes the session', async () => {
    const { relay, client } = setup()
    const agent = client.agent({ name: 'a', client: 'example', instanceId: 'ia' })
    await agent.claim()
    await agent.setStatus({ state: 'working', task: 'tests', waitingFor: 'cc:api' })
    expect(relay.state.keys.get('status:a')).toEqual({ instanceId: 'ia', state: 'working', task: 'tests', waitingFor: 'cc:api' })
    await agent.close()
    expect(relay.state.sessions.get('a')!.closed).toBe(true)
  })

  it('refuses a status the relay would refuse', async () => {
    const { client } = setup()
    const agent = client.agent({ name: 'a', client: 'example' })
    await expect(agent.setStatus({ state: 'sleeping' as 'idle', task: 'x' })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(agent.setStatus({ state: 'idle', task: '' })).rejects.toMatchObject({ code: 'invalid_request' })
  })
})
