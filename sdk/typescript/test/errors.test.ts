import { describe, expect, it } from 'vitest'
import { ClawalkietalkieError, createClient, PlanRequiredError } from '../src/index.ts'
import { setup, SERVER } from './helpers.ts'

describe('errors and the wire', () => {
  it('sends the bearer token and turns a refusal into a typed error with its details', async () => {
    const { relay, client } = setup()
    relay.fail({ path: /^\/v1\/sessions$/, status: 402, body: { error: 'plan_limit', limit: 'agents', max: 2, upgrade: 'https://x' } })
    const error = await client.agents().catch((e: unknown) => e) as ClawalkietalkieError
    expect(error).toBeInstanceOf(ClawalkietalkieError)
    expect(error).toMatchObject({ code: 'plan_limit', status: 402, details: { limit: 'agents', max: 2 } })
    expect(error.message).toMatch(/plan/i)
    expect(relay.state.calls[0]!.headers.authorization).toBe('Bearer tok_test_secret')
  })

  it('never puts the token in an error', async () => {
    const { relay, client } = setup()
    relay.fail({ path: /./, status: 500, body: { error: 'internal_error' } })
    const error = await client.me().catch((e: unknown) => e) as Error
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain('tok_test_secret')
  })

  it('answers unreachable for a network failure and timeout for a slow relay', async () => {
    const { relay, client } = setup()
    relay.fail({ path: /./, status: 0, network: true })
    await expect(client.me()).rejects.toMatchObject({ code: 'unreachable', status: 0 })
    const slow = createClient({ token: 't', server: SERVER, timeoutMs: 10, fetch: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) })
    await expect(slow.me()).rejects.toMatchObject({ code: 'timeout' })
  })

  it('reads a non-JSON error body as its status', async () => {
    const client = createClient({ token: 't', server: SERVER, fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }) })
    await expect(client.me()).rejects.toMatchObject({ code: 'http_502', status: 502, retryable: true })
  })

  it('exposes the details of an unrelated recipient and a loop guard', () => {
    const unrelated = new ClawalkietalkieError(409, 'unrelated_recipient', { project: 'web', suggest: ['cc:web'] })
    expect(unrelated.project).toBe('web')
    expect(unrelated.suggest).toEqual(['cc:web'])
    expect(unrelated.message).toContain('web')
    const loop = new ClawalkietalkieError(429, 'loop_guard', { reason: 'pair_busy', hint: 'stop' })
    expect(loop.reason).toBe('pair_busy')
    expect(loop.hint).toBe('stop')
    expect(loop.retryable).toBe(false)
  })
})

describe('plan_required', () => {
  it('is a PlanRequiredError with the hint and where to upgrade', async () => {
    const { relay, client } = setup()
    relay.fail({ path: /^\/v1\/sessions\//, method: 'PUT', status: 402, body: { error: 'plan_required', hint: 'Custom products need Pro.', upgrade: 'https://clawalkietalkie.com/#pricing' } })
    const error = await client.agent({ name: 'bot', client: 'my-product' }).claim().catch((e: unknown) => e) as PlanRequiredError
    expect(error).toBeInstanceOf(PlanRequiredError)
    expect(error).toBeInstanceOf(ClawalkietalkieError)
    expect(error).toMatchObject({ code: 'plan_required', status: 402, hint: 'Custom products need Pro.', upgrade: 'https://clawalkietalkie.com/#pricing' })
    expect(error.message).toContain('Custom products need Pro.')
  })
})
