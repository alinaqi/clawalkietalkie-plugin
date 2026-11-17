import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/index.ts'
import { createFakeRelay, TOKEN } from './fake-relay.ts'

const dir = mkdtempSync(join(tmpdir(), 'cwt-'))

describe('the token', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('reads a token file, plain or the JSON the MCP server keeps', async () => {
    const relay = createFakeRelay()
    writeFileSync(join(dir, 'plain'), `${TOKEN}\n`)
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ token: TOKEN, email: 'me@example.com' }))
    for (const file of ['plain', 'auth.json']) {
      await expect(createClient({ tokenFile: join(dir, file), server: 'http://x', fetch: relay.fetch }).me()).resolves.toMatchObject({ kind: 'person' })
    }
  })

  it('falls back to CLAWALKIETALKIE_TOKEN and CLAWALKIETALKIE_SERVER', async () => {
    const relay = createFakeRelay()
    vi.stubEnv('CLAWALKIETALKIE_TOKEN', TOKEN)
    vi.stubEnv('CLAWALKIETALKIE_SERVER', 'http://env.test')
    await createClient({ fetch: relay.fetch }).me()
    expect(relay.state.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('says how to get a token when there is none', () => {
    vi.stubEnv('CLAWALKIETALKIE_TOKEN', '')
    expect(() => createClient({})).toThrow(/signIn|CLAWALKIETALKIE_TOKEN/)
  })

  it('defaults to the production relay', async () => {
    const urls: string[] = []
    const client = createClient({ token: 't', fetch: async (url) => { urls.push(String(url)); return new Response('{}') } })
    await client.me()
    expect(urls[0]).toBe('https://api.clawalkietalkie.com/v1/me')
  })
})
