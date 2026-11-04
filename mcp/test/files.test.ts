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
