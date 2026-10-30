import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createFakeRelay } from '../../claude-code/tests/fake-relay.ts'
import { createAgent } from '../src/agent.ts'
import { saveAuth } from '../src/config.ts'
import { createServer } from '../src/server.ts'

const connect = async (clientName: string, kind?: string) => {
  const relay = createFakeRelay()
  const dir = mkdtempSync(join(tmpdir(), 'cwt-server-'))
  saveAuth(dir, { token: 'tok-1', email: 'a@x.io' })
  const agent = createAgent({ fetch: async (url, init) => relay.fetch(url, init), dir, serverUrl: 'https://relay.test', cwd: '/work/api' })
  const server = createServer(agent, { kind, poll: false })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: clientName, version: '1.0.0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  await agent.ready
  return { client, relay }
}

const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

describe('the MCP server', () => {
  it('offers the messaging tools and says how to use them', async () => {
    const { client } = await connect('codex-mcp-client')
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['inbox', 'login', 'rename', 'send', 'status', 'verify', 'who'])
    expect(client.getInstructions()).toMatch(/inbox/)
  })

  it('registers under the kind the client name implies', async () => {
    const { relay } = await connect('codex-mcp-client')
    expect(relay.find('PUT', '/v1/sessions/')[0]?.body).toMatchObject({ kind: 'cx' })
  })

  it('lets --kind override the client name', async () => {
    const { relay } = await connect('codex-mcp-client', 'gh')
    expect(relay.find('PUT', '/v1/sessions/')[0]?.body).toMatchObject({ kind: 'gh' })
  })

  it('sends through the send tool', async () => {
    const { client } = await connect('cursor-vscode')
    const result = await client.callTool({ name: 'send', arguments: { to: 'cc:happy-cat', text: 'hi' } })
    expect(text(result)).toMatch(/Sent to cc:happy-cat/)
  })

  it('reads the inbox through the inbox tool', async () => {
    const { client, relay } = await connect('codex-mcp-client')
    relay.deliver('cc:happy-cat', 'ping')
    expect(text(await client.callTool({ name: 'inbox', arguments: {} }))).toContain('ping')
  })
})
