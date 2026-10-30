import { expect, test } from 'claude-code/testing'
import { formatAddress, formatTarget, generateName, isValidName, parseAddress, parseTarget, suggestName } from '../hooks/lib/address.ts'

test('parseAddress takes cc: or bare names, trimmed and lowercased', async () => {
  expect(parseAddress('cc:happy-dog')).toBe('happy-dog')
  expect(parseAddress('  CC:Happy-Dog ')).toBe('happy-dog')
  expect(parseAddress('happy-dog')).toBe('happy-dog')
  expect(parseAddress('a')).toBe('a')
})

test('parseAddress refuses what is not a name', async () => {
  for (const bad of ['', 'cc:', '-dog', 'dog-', 'happy dog', 'happy_dog', 'x'.repeat(33), 'cc:a@b', 'zz:dog']) {
    expect(parseAddress(bad)).toBe(null)
  }
})

test('isValidName allows 32 characters at most', async () => {
  expect(isValidName('x'.repeat(32))).toBe(true)
  expect(isValidName('x'.repeat(33))).toBe(false)
})

test('formatAddress prefixes cc:', async () => {
  expect(formatAddress('happy-dog')).toBe('cc:happy-dog')
})

test('generateName makes a valid adjective-animal name', async () => {
  expect(generateName(() => 0)).toBe('happy-cat')
  expect(generateName(() => 0.999)).toBe('zesty-yak')
  expect(isValidName(generateName(Math.random))).toBe(true)
})

test('suggestName finds the name a typo meant', async () => {
  const names = ['lucky-crane', 'happy-cat', 'happy-dog']
  expect(suggestName('luckycrane', names)).toBe('lucky-crane')
  expect(suggestName('hapy-cat', names)).toBe('happy-cat')
  expect(suggestName('happy-cta', names)).toBe('happy-cat')
})

test('suggestName offers nothing for a name far from every other', async () => {
  expect(suggestName('zesty-yak', ['lucky-crane', 'happy-cat'])).toBe(null)
  expect(suggestName('cat', [])).toBe(null)
})

test('parseTarget keeps the agent prefix, or null when none is given', async () => {
  expect(parseTarget('CX:Review-Bot')).toEqual({ kind: 'cx', name: 'review-bot', team: null })
  expect(parseTarget('gb:voice')).toEqual({ kind: 'gb', name: 'voice', team: null })
  expect(parseTarget('ca:desk')).toEqual({ kind: 'ca', name: 'desk', team: null })
  expect(parseTarget('gp:chat')).toEqual({ kind: 'gp', name: 'chat', team: null })
  expect(parseTarget('review-bot')).toEqual({ kind: null, name: 'review-bot', team: null })
  expect(parseTarget('zz:review-bot')).toBe(null)
})

test('formatAddress takes the kind, cc by default', async () => {
  expect(formatAddress('review-bot', 'cx')).toBe('cx:review-bot')
})

test('parseTarget reads a team address, kind and team optional', async () => {
  expect(parseTarget(' CX:Review@Acme ')).toEqual({ kind: 'cx', name: 'review', team: 'acme' })
  expect(parseTarget('api@acme')).toEqual({ kind: null, name: 'api', team: 'acme' })
  for (const bad of ['api@', 'api@a@b', 'api@-x', '@acme', 'zz:api@acme']) expect(parseTarget(bad)).toBe(null)
})

test('parseAddress takes personal addresses only', async () => {
  expect(parseAddress('cc:api@acme')).toBe(null)
  expect(parseAddress('cc:api')).toBe('api')
})

test('formatAddress adds the team when there is one', async () => {
  expect(formatAddress('api', 'cc', 'acme')).toBe('cc:api@acme')
  expect(formatAddress('api', 'cx', null)).toBe('cx:api')
})

test('formatTarget writes a target back, keeping a missing kind missing', async () => {
  expect(formatTarget({ kind: 'cx', name: 'review', team: 'acme' })).toBe('cx:review@acme')
  expect(formatTarget({ kind: null, name: 'api', team: 'acme' })).toBe('api@acme')
  expect(formatTarget({ kind: null, name: 'api', team: null })).toBe('api')
})
