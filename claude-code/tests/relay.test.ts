import { expect, test } from 'claude-code/testing'
import { createRelay, type Fetch } from '../hooks/lib/relay.ts'

interface Seen { url: string, method?: string, body?: unknown, auth?: string }

const fakeFetch = (status: number, body: unknown) => {
  const seen: Seen[] = []
  const fetch: Fetch = async (url, init) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      auth: init?.headers?.authorization
    })
    return { status, ok: status < 300, text: body === undefined ? '' : JSON.stringify(body) }
  }
  return { fetch, seen }
}

const BASE = { baseUrl: 'https://relay.test/', token: 'tok' }

test('send posts to /v1/messages with the bearer token', async () => {
  const { fetch, seen } = fakeFetch(201, { id: 'm1', online: true })
  const res = await createRelay(fetch, BASE).send({ from: 'a', instanceId: 'i', to: 'b', text: 'hi' })
  expect(res).toEqual({ ok: true, value: { id: 'm1', online: true } })
  expect(seen[0]).toEqual({
    url: 'https://relay.test/v1/messages',
    method: 'POST',
    body: { from: 'a', instanceId: 'i', to: 'b', text: 'hi' },
    auth: 'Bearer tok'
  })
})

test('inbox long-polls with the instance and wait in the query', async () => {
  const { fetch, seen } = fakeFetch(200, { messages: [] })
  const res = await createRelay(fetch, BASE).inbox('happy-dog', 'inst 1', 25)
  expect(res).toEqual({ ok: true, value: [] })
  expect(seen[0]?.url).toBe('https://relay.test/v1/inbox/happy-dog?instanceId=inst%201&wait=25')
})

test('a relay error comes back as its status and code', async () => {
  const { fetch } = fakeFetch(409, { error: 'name_taken' })
  const res = await createRelay(fetch, BASE).claim('x', { instanceId: 'i' })
  expect(res).toEqual({ ok: false, status: 409, error: 'name_taken' })
})

test('a failed request comes back as unreachable', async () => {
  const fetch: Fetch = async () => { throw new Error('ECONNREFUSED') }
  const res = await createRelay(fetch, BASE).list()
  expect(res).toEqual({ ok: false, status: 0, error: 'unreachable' })
})

test('requests without a token carry no authorization header', async () => {
  const { fetch, seen } = fakeFetch(202, {})
  await createRelay(fetch, { baseUrl: 'https://relay.test' }).requestCode('a@x.io')
  expect(seen[0]?.auth).toBe(undefined)
  expect(seen[0]?.url).toBe('https://relay.test/v1/auth/otp')
})
