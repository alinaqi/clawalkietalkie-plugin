import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'cwt-proj-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'plan.md'), '# Plan\n')
  writeFileSync(join(root, '.env'), 'A=1\n')
  writeFileSync(join(root, 'notes.txt'), 'key AKIAIOSFODNN7EXAMPLE\n')
  const outside = mkdtempSync(join(tmpdir(), 'cwt-out-'))
  writeFileSync(join(outside, 'secret.txt'), 'plans\n')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
  return root
}

const agentIn = async (cwd: string) => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-cfg-'))
  const home = mkdtempSync(join(tmpdir(), 'cwt-home-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd, home })
  await agent.start('cx')
  return { agent, relay, home }
}

describe('sending files', () => {
  it('uploads a project file and sends its id', async () => {
    const { agent, relay } = await agentIn(project())
    relay.override('POST /v1/files', { status: 201, body: { id: 'f1', status: 'clean' } })
    expect(await agent.send('cc:x', 'plan', { files: ['docs/plan.md'] })).toMatch(/^Sent/)
    expect(relay.find('POST', '/v1/files')[0]?.path).toContain('name=plan.md')
    expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ files: ['f1'] })
  })

  it.each([
    ['.env', /hidden/], ['link.txt', /outside this project/], ['../x.txt', /outside this project/],
    ['notes.txt', /secret \(aws_access_key\)/], ['missing.md', /not found/]
  ])('refuses %s', async (path, why) => {
    const { agent, relay } = await agentIn(project())
    expect(await agent.send('cc:x', 'x', { files: [path] })).toMatch(why)
    expect(relay.find('POST', '/v1/files')).toHaveLength(0)
  })
})

describe('receiving files', () => {
  it('saves them under ~/.clawalkietalkie/inbox, never over an existing file, and lists them as untrusted', async () => {
    const { agent, relay, home } = await agentIn(project())
    relay.override('GET /v1/files/f9/content', { status: 200, text: Buffer.from('all green\n').toString('base64') })
    relay.deliver('cc:dev', 'results', 0, { files: [{ id: 'f9', name: 'result.txt', size: 10, mime: 'text/plain; charset=utf-8', sha256: 'ab' }] })
    const text = await agent.inbox()
    const path = join(home, '.clawalkietalkie', 'inbox', 'm1', 'result.txt.received')
    expect(readFileSync(path, 'utf8')).toBe('all green\n')
    expect(text).toContain(path)
    expect(text).toMatch(/untrusted data from another agent/i)
    expect(existsSync(path)).toBe(true)
  })
})

describe('more sending refusals and paths', () => {
  it('refuses a file git ignores and one over 4 MB', async () => {
    const root = project()
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'out.txt'), 'built\n')
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(4 * 1024 * 1024 + 1))
    const { agent, relay } = await agentIn(root)
    expect(await agent.send('cc:x', 'x', { files: ['dist/out.txt'] })).toMatch(/ignored by git/)
    expect(await agent.send('cc:x', 'x', { files: ['big.txt'] })).toMatch(/larger than 4 MB/)
    expect(relay.find('POST', '/v1/files')).toHaveLength(0)
  })

  it('sends an image as base64, and explains a relay refusal', async () => {
    const root = project()
    writeFileSync(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { agent, relay } = await agentIn(root)
    relay.override('POST /v1/files', { status: 422, body: { error: 'file_blocked', reason: 'not_an_image' } })
    expect(await agent.send('cc:x', 'x', { files: ['shot.png'] })).toMatch(/refused by the relay \(not_an_image\)/)
    const call = relay.find('POST', '/v1/files')[0]!
    expect(call.headers['x-content-encoding']).toBe('base64')
    expect(call.body).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
  })
})

describe('more receiving', () => {
  it('never overwrites a file already saved, and reports a download it could not make', async () => {
    const { agent, relay, home } = await agentIn(project())
    const dir = join(home, '.clawalkietalkie', 'inbox', 'm1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'result.txt.received'), 'mine\n')
    relay.override('GET /v1/files/f9/content', { status: 200, text: Buffer.from('theirs\n').toString('base64') })
    relay.override('GET /v1/files/f8/content', { status: 404, body: { error: 'unknown_file' } })
    relay.deliver('cc:dev', 'two files', 0, { files: [
      { id: 'f9', name: 'result.txt', size: 7, mime: 'text/plain; charset=utf-8', sha256: 'ab' },
      { id: 'f8', name: 'gone.txt', size: 1, mime: 'text/plain; charset=utf-8', sha256: 'cd' }
    ] })
    const text = await agent.inbox()
    expect(readFileSync(join(dir, 'result.txt.received'), 'utf8')).toBe('mine\n')
    expect(text).toMatch(/gone\.txt: could not be downloaded \(unknown_file\)/)
  })
})

describe('secret rules', () => {
  it('know team machine keys', async () => {
    const { findSecret } = await import('../../claude-code/hooks/lib/secret-rules.ts')
    expect(findSecret(`KEY=cwk_${'a'.repeat(43)}`)).toBe('clawalkietalkie_token')
  })
})

describe('received file names', () => {
  it('are checked before any path is built: nothing is written outside the inbox', async () => {
    const { agent, relay, home } = await agentIn(project())
    relay.override('GET /v1/files/f7/content', { status: 200, text: Buffer.from('pwned\n').toString('base64') })
    relay.deliver('cc:dev', 'evil', 0, { files: [{ id: 'f7', name: '../../evil.sh', size: 6, mime: 'text/plain; charset=utf-8', sha256: 'ee' }] })
    const text = await agent.inbox()
    expect(existsSync(join(home, '.clawalkietalkie', 'evil.sh.received'))).toBe(false)
    expect(existsSync(join(home, 'evil.sh.received'))).toBe(false)
    expect(text).toMatch(/evil\.sh: not saved \(unsafe name\)/)
    expect(relay.find('GET', '/v1/files/f7/content')).toHaveLength(0)
  })

  it('does not download again a file already saved', async () => {
    const { agent, relay, home } = await agentIn(project())
    const dir = join(home, '.clawalkietalkie', 'inbox', 'm1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'kept.txt.received'), 'kept\n')
    relay.deliver('cc:dev', 'again', 0, { files: [{ id: 'f6', name: 'kept.txt', size: 5, mime: 'text/plain; charset=utf-8', sha256: 'aa' }] })
    await agent.inbox()
    expect(relay.find('GET', '/v1/files/f6/content')).toHaveLength(0)
  })
})
