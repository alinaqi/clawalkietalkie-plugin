import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setup } from './helpers.ts'

describe('files', () => {
  it('uploads bytes or a path as the agent, and downloads them', async () => {
    const { relay, client } = setup()
    const agent = client.agent({ name: 'a', client: 'example', instanceId: 'ia' })
    const fromBytes = await agent.uploadFile(new TextEncoder().encode('hello'), 'notes.txt')
    const path = join(mkdtempSync(join(tmpdir(), 'cwt-')), 'report.md')
    writeFileSync(path, '# report')
    const fromPath = await client.uploadFile(path, undefined, agent)
    expect(fromBytes).toMatchObject({ id: 'f1', name: 'notes.txt', size: 5, status: 'clean' })
    expect(fromPath.name).toBe('report.md')
    const upload = relay.callsTo(/^\/v1\/files$/)[0]!
    expect(upload.headers['content-type']).toBe('application/octet-stream')
    expect(Object.fromEntries(upload.query)).toEqual({ from: 'a', instanceId: 'ia', name: 'notes.txt' })
    expect(new TextDecoder().decode(await agent.downloadFile('f1'))).toBe('hello')
    expect(relay.callsTo(/content$/)[0]!.query.get('as')).toBe('a')
  })

  it('sends file ids with a message', async () => {
    const { relay, client } = setup()
    relay.state.sessions.set('b', { name: 'b', kind: 'ex', instanceId: 'x', live: true, closed: false })
    const agent = client.agent({ name: 'a', client: 'example' })
    await agent.send('b', 'see attached', { files: ['f1'] })
    expect((relay.callsTo(/^\/v1\/messages$/)[0]!.body as { files: string[] }).files).toEqual(['f1'])
  })

  it('types a missing file', async () => {
    const { client } = setup()
    await expect(client.agent({ name: 'a', client: 'example' }).downloadFile('nope')).rejects.toMatchObject({ code: 'unknown_file' })
  })
})
