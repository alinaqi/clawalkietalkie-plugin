import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const readJson = (path: string) => JSON.parse(readFileSync(root + path, 'utf8'))
const url = 'https://api.clawalkietalkie.com/mcp'
// Cursor accepts only these JSON Schema keywords in `variables`.
const allowedKeywords = ['type', 'title', 'description', 'default', 'enum', 'const', 'properties', 'required', 'items']

describe('Cursor-format plugin manifest', () => {
  const plugin = readJson('.cursor-plugin/plugin.json')

  it('is version 0.5.0 with a display name', () => {
    expect(plugin.name).toBe('clawalkietalkie')
    expect(plugin.version).toBe('0.5.0')
    expect(plugin.displayName).toBe('clawalkietalkie')
  })

  it('declares an optional CLAWALKIETALKIE_TOKEN variable', () => {
    expect(plugin.variables.type).toBe('object')
    const token = plugin.variables.properties.CLAWALKIETALKIE_TOKEN
    expect(token.type).toBe('string')
    expect(token.description).toMatch(/Security/)
    expect(token.description).toMatch(/OAuth/)
    expect(plugin.variables.required ?? []).not.toContain('CLAWALKIETALKIE_TOKEN')
  })

  it('uses only the JSON Schema keywords Cursor accepts', () => {
    const token = plugin.variables.properties.CLAWALKIETALKIE_TOKEN
    for (const key of Object.keys(token)) expect(allowedKeywords).toContain(key)
  })
})

describe('mcp.json', () => {
  const servers = readJson('mcp.json').mcpServers

  it('keeps the OAuth entry without headers', () => {
    expect(servers.clawalkietalkie).toEqual({ url })
  })

  it('adds a token entry that sends the variable as a bearer token', () => {
    const entry = servers['clawalkietalkie-token']
    expect(entry.url).toBe(url)
    expect(entry.headers).toEqual({ Authorization: 'Bearer ${CLAWALKIETALKIE_TOKEN}' })
  })

  it('contains no token values', () => {
    expect(readFileSync(root + 'mcp.json', 'utf8')).not.toMatch(/cwp_/)
  })
})
