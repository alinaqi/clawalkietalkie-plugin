// Opt-in, against a local relay only (never production): CLAWALKIETALKIE_E2E_SERVER=http://127.0.0.1:8797 and
// CLAWALKIETALKIE_E2E_LOG=<the relay's log file>, where the development relay writes sign-in codes.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BlockedByPublisherError, createClient, InvalidCursorError, isClawalkietalkieError, NotStreamingError, TextTooLongError, PlanRequiredError, signIn, type Client, type Update } from '../src/index.ts'
import { until } from './helpers.ts'

const server = process.env.CLAWALKIETALKIE_E2E_SERVER ?? ''
const log = process.env.CLAWALKIETALKIE_E2E_LOG ?? ''
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(server)

const codeFor = async (email: string): Promise<string> => {
  for (let i = 0; i < 50; i++) {
    const lines = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes(email) && l.includes('"code"'))
    const last = lines.at(-1)
    if (last) return (JSON.parse(last) as { code: string }).code
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`no code for ${email} in ${log}`)
}

const signedIn = async (): Promise<Client> => {
  const email = `sdk-ts-${Date.now()}@example.com`
  await signIn.start(email, { server })
  const { token } = await signIn.verify(email, await codeFor(email), { device: 'sdk-e2e@test', server })
  return createClient({ token, server })
}

describe.skipIf(!isLocal || !log)('end to end against a local relay', () => {
  // Anything that forgets `server` goes to the local relay too, never to production.
  beforeAll(() => { vi.stubEnv('CLAWALKIETALKIE_SERVER', server) })

  it('signs in, claims, echoes a request and a file, and reports refusals', async (ctx) => {
    const client = await signedIn()
    expect(await client.me()).toMatchObject({ kind: 'person' })
    const echo = client.agent({ name: 'echo', client: 'example-echo', cwd: 'sdk' })
    try { await echo.claim() } catch (error) {
      if (error instanceof PlanRequiredError) return ctx.skip(`relay needs a paid plan: ${error.hint ?? ''}`)
      throw error
    }
    const sender = client.agent({ client: 'example-echo' })
    await sender.claim()
    const listenErrors: unknown[] = []
    const stop = echo.listen(async (m) => {
      if (m.text === 'quiet') return
      const file = m.files?.[0]
      const extra = file ? ` + ${new TextDecoder().decode(await echo.downloadFile(file.id))}` : ''
      await m.reply(`echo: ${m.text}${extra}`)
    }, { onError: (e) => { listenErrors.push(e) } })
    const sent = await sender.send(echo.address!, 'ping', { type: 'request' })
    expect((await sender.waitForReply(sent.id, { timeoutMs: 20_000 })).replies[0]?.text).toBe('echo: ping')
    const file = await sender.uploadFile(new TextEncoder().encode('hello file'), 'notes.txt')
    const withFile = await sender.send(echo.address!, 'see file', { type: 'request', files: [file.id] })
    expect((await sender.waitForReply(withFile.id, { timeoutMs: 20_000 })).replies[0]?.text).toBe('echo: see file + hello file')
    // Past the relay's 10 s socket timeout: a cut long-poll is waited through, and the listener keeps answering.
    const quiet = await sender.send(echo.address!, 'quiet', { type: 'request' })
    expect(await sender.waitForReply(quiet.id, { timeoutMs: 12_000 })).toMatchObject({ timedOut: true, replies: [] })
    const again = await sender.send(echo.address!, 'again', { type: 'request' })
    expect((await sender.waitForReply(again.id, { timeoutMs: 20_000 })).replies[0]?.text).toBe('echo: again')
    expect(listenErrors).toEqual([])
    const refused = await sender.send('nobody-here', 'hi').catch((e: unknown) => e)
    expect(isClawalkietalkieError(refused, 'unknown_address')).toBe(true)
    await echo.setStatus({ state: 'working', task: 'echoing' })
    expect((await client.agents()).find((a) => a.address === echo.address)?.status).toMatchObject({ state: 'working' })
    expect((await client.activity()).events.length).toBeGreaterThan(0)
    const minted = await client.mintDeviceToken('e2e app')
    expect((await client.deviceTokens()).some((t) => t.id === minted.id)).toBe(true)
    await client.revokeDeviceToken(minted.id)
    await stop()
    await Promise.all([echo.close(), sender.close()])
  }, 60_000)

  // A built-in product id, so a Free account may claim it.
  it('streams updates: one agent posts, another follows and reads them by hand and through listen', async () => {
    const client = await signedIn()
    const publisher = client.agent({ client: 'codex', cwd: 'sdk' })
    const follower = client.agent({ client: 'codex', cwd: 'sdk' })
    await Promise.all([publisher.claim(), follower.claim()])
    expect(await follower.follow(publisher.address!).catch((e: unknown) => e)).toBeInstanceOf(NotStreamingError)
    expect(await publisher.setStreaming({ on: true, includeStatus: true })).toEqual({ on: true, includeStatus: true })
    expect((await follower.follow(publisher.address!)).to).toBe(publisher.address)
    expect(await follower.following()).toEqual([expect.objectContaining({ to: publisher.address, active: true })])
    expect((await publisher.followers()).followers.map((f) => f.address)).toEqual([follower.address])
    expect(typeof (await publisher.postUpdate('step 1 done')).id).toBe('number')
    const page = await follower.updates({ wait: 5 })
    expect(page.updates.map((u) => [u.from, u.kind, u.text])).toEqual([[publisher.address, 'post', 'step 1 done']])
    const seen: Update[] = []
    const errors: unknown[] = []
    const stop = follower.listen(async () => {}, { onUpdate: (u) => { seen.push(u) }, onError: (e) => { errors.push(e) } })
    await until(() => seen.length === 1, 10_000)
    await publisher.postUpdate('step 2 done')
    await publisher.setStatus({ state: 'working', task: 'streaming e2e' })
    await until(() => seen.length === 3, 10_000)
    expect(seen.map((u) => [u.kind, u.text])).toEqual([['post', 'step 1 done'], ['post', 'step 2 done'], ['status', 'working: streaming e2e']])
    expect(errors).toEqual([])
    await stop()
    await follower.unfollow(publisher.address!)
    expect(await follower.following()).toEqual([])
    await Promise.all([publisher.close(), follower.close()])
  }, 60_000)

  it('removes a follower, which is blocked until unblocked, and meets the relay\'s cursor code', async () => {
    const client = await signedIn()
    const publisher = client.agent({ client: 'codex', cwd: 'sdk' })
    const follower = client.agent({ client: 'codex', cwd: 'sdk' })
    await Promise.all([publisher.claim(), follower.claim()])
    await publisher.setStreaming({ on: true })
    await follower.follow(publisher.address!)
    await publisher.removeFollower(follower.address!)
    const listed = await publisher.followers()
    expect(listed.followers).toEqual([])
    expect(listed.blocked.map((b) => b.address)).toEqual([follower.address])
    expect(await follower.follow(publisher.address!).catch((e: unknown) => e)).toBeInstanceOf(BlockedByPublisherError)
    await publisher.unblockFollower(follower.address!)
    expect((await publisher.followers()).blocked).toEqual([])
    expect((await follower.follow(publisher.address!)).to).toBe(publisher.address)
    expect(await follower.updates({ after: 'not-a-cursor' }).catch((e: unknown) => e)).toBeInstanceOf(InvalidCursorError)
    expect(await publisher.postUpdate('x'.repeat(2001)).catch((e: unknown) => e)).toBeInstanceOf(TextTooLongError)
    await Promise.all([publisher.close(), follower.close()])
  }, 60_000)
})
