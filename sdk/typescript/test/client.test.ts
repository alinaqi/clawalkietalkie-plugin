import { describe, expect, it } from 'vitest'
import { signIn } from '../src/index.ts'
import { createFakeRelay } from './fake-relay.ts'
import { setup, SERVER } from './helpers.ts'

describe('signing in', () => {
  it('asks for a code, then trades it for a token', async () => {
    const relay = createFakeRelay()
    await signIn.start('Me@Example.com', { server: SERVER, fetch: relay.fetch })
    const done = await signIn.verify('me@example.com', '123456', { device: 'my-app@host', server: SERVER, fetch: relay.fetch })
    expect(done).toEqual({ token: 'tok_new', email: 'me@example.com' })
    expect(relay.state.calls[1]!.body).toEqual({ email: 'me@example.com', code: '123456', device: 'my-app@host' })
  })

  it('refuses a wrong code with invalid_code', async () => {
    const relay = createFakeRelay()
    await expect(signIn.verify('me@example.com', '000000', { device: 'd', server: SERVER, fetch: relay.fetch })).rejects.toMatchObject({ code: 'invalid_code', status: 401 })
  })
})

describe('the account', () => {
  it('reads me, agents, kinds and activity', async () => {
    const { client } = setup()
    expect(await client.me()).toEqual({ kind: 'person', email: 'me@example.com' })
    expect(await client.agents()).toEqual([])
    expect((await client.kinds())[0]).toMatchObject({ kind: 'cc', product: 'claude-code' })
    expect(await client.activity({ after: '7' })).toEqual({ events: [], cursor: '7' })
  })

  it('mints, lists and revokes device tokens', async () => {
    const { relay, client } = setup()
    expect(await client.mintDeviceToken('laptop app')).toMatchObject({ token: 'tok_minted', device: 'laptop app' })
    expect((await client.deviceTokens())[0]).toMatchObject({ id: '0123456789abcdef', minted: true })
    await client.revokeDeviceToken('0123456789abcdef')
    await expect(client.revokeDeviceToken('ffffffffffffffff')).rejects.toMatchObject({ code: 'unknown_token' })
    expect(relay.callsTo(/device-tokens\/0123/, 'DELETE')).toHaveLength(1)
  })
})
