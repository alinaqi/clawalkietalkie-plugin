import { expect, test } from 'claude-code/testing'
import { SEND_TOOL } from '../hooks/lib/tools.ts'
import { fakeDisk } from './fake-disk.ts'
import { SEND, SIGNED_IN, setup, start } from './harness.ts'

const uploads = (relay: ReturnType<typeof setup>['relay']) => relay.find('POST', '/v1/files')

test('the send tool takes paths of files to send', () => {
  const props = SEND_TOOL.inputSchema?.properties as Record<string, { type?: string, description?: string }>
  expect(props.files?.type).toBe('array')
  expect(props.files?.description).toMatch(/approval/i)
})

test('a file in the project is uploaded and sent with the message', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  fakeDisk(on, { '/work/web/docs/plan.md': '# Plan\n' })
  relay.override('POST /v1/files', { status: 201, body: { id: 'f1', name: 'plan.md', status: 'clean' } })
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'the plan', files: ['docs/plan.md'] })
  expect(res.result).toMatch(/Sent to cc:happy-cat/)
  expect(uploads(relay)[0]?.path).toBe('/v1/files?from=happy-dog&instanceId=inst-dog&name=plan.md')
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ files: ['f1'] })
})

test('an image goes as base64', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  fakeDisk(on, { '/work/web/shot.png': '\u0089PNG' })
  relay.override('POST /v1/files', { status: 201, body: { id: 'f2', status: 'clean' } })
  await start($)
  await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'look', files: ['shot.png'] })
  expect(uploads(relay)[0]?.headers['x-content-encoding']).toBe('base64')
})

test('refuses files outside the project, hidden, secret, ignored, or holding a secret, and sends nothing', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  const disk = fakeDisk(on, {
    '/etc/passwd.txt': 'root', '/work/web/.env': 'A=1', '/work/web/keys/id_rsa.pem': 'x', '/work/web/dist/out.txt': 'built',
    '/work/web/notes.txt': 'token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB', '/outside/real.txt': 'secret plans'
  }, { links: { '/work/web/link.txt': '/outside/real.txt' } })
  disk.ignored.add('/work/web/dist/out.txt')
  await start($)
  const tries: Array<[string, RegExp]> = [
    ['/etc/passwd.txt', /outside this project/], ['../x.txt', /outside this project/], ['link.txt', /outside this project/],
    ['.env', /hidden/], ['keys/id_rsa.pem', /key or credentials/], ['dist/out.txt', /ignored/],
    ['notes.txt', /looks like a secret \(github_token\)/], ['missing.md', /not found/]
  ]
  for (const [path, why] of tries) {
    expect((await $.tool.call({ tool: SEND, to: 'cc:happy-cat', text: 'x', files: [path] })).result).toMatch(why)
  }
  expect(uploads(relay)).toHaveLength(0)
  expect(relay.find('POST', '/v1/messages')).toHaveLength(0)
})

test('a received text file is saved outside the project and listed as untrusted data', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  const disk = fakeDisk(on)
  relay.override('GET /v1/files/f9/content', { status: 200, text: 'all 12 tests pass\n' })
  relay.deliver('cc:happy-cat', 'results attached', 0, { files: [{ id: 'f9', name: 'result.txt', size: 18, mime: 'text/plain; charset=utf-8', sha256: 'ab' }] })
  await start($)
  await clock.advance(1000)
  expect(disk.written.get('/home/me/.clawalkietalkie/inbox/m1/result.txt.received')).toBe('all 12 tests pass\n')
  expect(seen.prompts[0]).toMatch(/\/home\/me\/\.clawalkietalkie\/inbox\/m1\/result\.txt\.received/)
  expect(seen.prompts[0]).toMatch(/untrusted data from another agent/i)
})

test('a received image is written through the shell from base64', async ($, on) => {
  const { relay, clock } = setup(on, SIGNED_IN)
  const disk = fakeDisk(on)
  relay.override('GET /v1/files/f8/content', { status: 200, text: 'iVBORw0K' })
  relay.deliver('cc:happy-cat', 'screenshot', 0, { files: [{ id: 'f8', name: 'shot.png', size: 6, mime: 'image/png', sha256: 'cd' }] })
  await start($)
  await clock.advance(1000)
  expect(disk.binaries.get('/home/me/.clawalkietalkie/inbox/m1/shot.png.received')).toBe('iVBORw0K')
})

test('a received file with an unsafe name is not saved or downloaded', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  const disk = fakeDisk(on)
  relay.deliver('cc:happy-cat', 'evil', 0, { files: [{ id: 'f7', name: '../../.zshrc', size: 6, mime: 'text/plain; charset=utf-8', sha256: 'ee' }] })
  await start($)
  await clock.advance(1000)
  expect([...disk.written.keys()]).toEqual([])
  expect(relay.find('GET', '/v1/files/f7/content')).toHaveLength(0)
  expect(seen.prompts[0]).toMatch(/not saved \(unsafe name\)/)
})
