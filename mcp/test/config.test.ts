import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identityFor, loadAuth, saveAuth } from '../src/config.ts'

const freshDir = () => mkdtempSync(join(tmpdir(), 'cwt-'))

describe('auth', () => {
  it('round-trips the token in a file only the user can read', () => {
    const dir = freshDir()
    saveAuth(dir, { token: 't', email: 'a@x.io' })
    expect(loadAuth(dir)).toEqual({ token: 't', email: 'a@x.io' })
    // Windows has no POSIX modes; there the file is private through the ACL on the profile folder.
    if (process.platform !== 'win32') expect(statSync(join(dir, 'auth.json')).mode & 0o777).toBe(0o600)
  })

  it('forgets the token', () => {
    const dir = freshDir()
    saveAuth(dir, { token: 't', email: 'a@x.io' })
    saveAuth(dir, undefined)
    expect(loadAuth(dir)).toBe(undefined)
  })
})

describe('identityFor', () => {
  it('keeps one name and instance per agent and folder', () => {
    const dir = freshDir()
    const first = identityFor(dir, 'cx:/work/api')
    expect(first.name).toMatch(/^[a-z]+-[a-z]+$/)
    expect(first.instanceId).toMatch(/^[0-9a-f]{32}$/)
    expect(identityFor(dir, 'cx:/work/api')).toEqual(first)
    expect(identityFor(dir, 'cx:/work/web').instanceId).not.toBe(first.instanceId)
  })
})
