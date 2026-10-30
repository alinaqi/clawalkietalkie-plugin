import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeOutputs } from '../src/outputs.ts'

describe('writeOutputs', () => {
  it('appends each output with a delimiter, so multi-line replies survive', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cwt-')), 'out')
    writeOutputs(file, { id: 'm1', reply: 'line one\nline two' })
    const text = readFileSync(file, 'utf8')
    expect(text).toMatch(/^id<<(\S+)\nm1\n\1\n/)
    expect(text).toContain('line one\nline two')
  })
})
