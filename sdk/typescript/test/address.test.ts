import { describe, expect, it } from 'vitest'
import { formatAddress, generateName, isValidName, parseAddress } from '../src/index.ts'

describe('addresses', () => {
  it('parses kind, name and team, trimmed and lowercased', () => {
    expect(parseAddress(' CX:Review-Bot ')).toEqual({ kind: 'cx', name: 'review-bot', team: null })
    expect(parseAddress('cc:api@acme')).toEqual({ kind: 'cc', name: 'api', team: 'acme' })
    expect(parseAddress('happy-dog')).toEqual({ kind: null, name: 'happy-dog', team: null })
  })

  it('refuses what the relay would refuse', () => {
    for (const bad of ['', '-a', 'a-', 'a@b@c', 'x:name', 'toolongkind:a', 'a_b', 'a'.repeat(33), 'a@-t']) expect(parseAddress(bad)).toBeNull()
  })

  it('checks names: 1 to 32 characters, no edge dash', () => {
    expect(isValidName('a')).toBe(true)
    expect(isValidName('a'.repeat(32))).toBe(true)
    expect(isValidName('-a')).toBe(false)
  })

  it('formats and generates', () => {
    expect(formatAddress({ kind: 'cu', name: 'web', team: 'acme' })).toBe('cu:web@acme')
    expect(formatAddress({ kind: null, name: 'web', team: null })).toBe('web')
    expect(generateName(() => 0)).toBe('happy-cat')
    expect(isValidName(generateName(Math.random))).toBe(true)
  })
})
