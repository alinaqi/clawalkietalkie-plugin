import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/main.ts'
import { fakeRelay } from './fake-relay.ts'

const env = (extra: Record<string, string> = {}) => ({
  INPUT_KEY: 'cwk_secret', INPUT_TO: 'cx:fixer@acme', INPUT_TEXT: 'Build failed', INPUT_SERVER: 'https://relay.test', ...extra
})

describe('main', () => {
  it('masks the key first, writes the outputs, and stops workflow commands around the reply', async () => {
    const lines: string[] = []
    const file = join(mkdtempSync(join(tmpdir(), 'cwt-')), 'out')
    const relay = fakeRelay([{ from: 'cx:fixer@acme', text: '::set-env name=X::evil' }])
    let time = 0
    const code = await main({ env: env({ INPUT_WAIT_SECONDS: '60', GITHUB_OUTPUT: file }), fetch: relay.fetch, now: () => (time += 1000), log: (l) => lines.push(l) })
    expect(code).toBe(0)
    expect(lines[0]).toBe('::add-mask::cwk_secret')
    const stop = lines.find((l) => l.startsWith('::stop-commands::'))!
    const token = stop.slice('::stop-commands::'.length)
    const replyAt = lines.findIndex((l) => l.includes('::set-env'))
    expect(lines.indexOf(stop)).toBeLessThan(replyAt)
    expect(lines.indexOf(`::${token}::`)).toBeGreaterThan(replyAt)
    expect(readFileSync(file, 'utf8')).toContain('::set-env name=X::evil')
  })

  it('reports an error line and a failing exit code', async () => {
    const lines: string[] = []
    const code = await main({ env: env({ INPUT_KEY: '' }), fetch: fakeRelay().fetch, now: () => 0, log: (l) => lines.push(l) })
    expect(code).toBe(1)
    expect(lines.at(-1)).toMatch(/^::error::.*key/)
  })
})
