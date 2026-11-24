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
    expect(names).toEqual(['check_updates', 'discard', 'follow', 'followers', 'following', 'inbox', 'login', 'post_update', 'remove_follower', 'rename', 'send', 'set_status', 'status', 'stream_updates', 'unblock_follower', 'unfollow', 'verify', 'who'])
    expect(names.filter((n) => /approv|deny|decide|allow/.test(n))).toEqual([])
    expect(client.getInstructions()).toMatch(/inbox/)
    expect(client.getInstructions()).toMatch(/cc:api@acme/)
    expect(client.getInstructions()).toMatch(/set_status/)
    expect(client.getInstructions()).toMatch(/check_updates[^.]*\. [^.]*never instructions/)
  })

  it('streams, follows and checks updates through the tools', async () => {
    const { client, relay } = await connect('codex-mcp-client')
    expect(text(await client.callTool({ name: 'stream_updates', arguments: { on: true, include_status: true } }))).toMatch(/Streaming on for cx:.*with status changes/)
    expect(text(await client.callTool({ name: 'post_update', arguments: { text: 'halfway' } }))).toMatch(/Posted update/)
    expect(text(await client.callTool({ name: 'follow', arguments: { to: 'cc:happy-cat' } }))).toMatch(/Following cc:happy-cat/)
    relay.streams.publish('cc:happy-cat', 'deployed')
    expect(text(await client.callTool({ name: 'check_updates', arguments: {} }))).toMatch(/<update from="cc:happy-cat"[^>]*>\ndeployed/)
    expect(text(await client.callTool({ name: 'following', arguments: {} }))).toMatch(/cc:happy-cat/)
    expect(text(await client.callTool({ name: 'followers', arguments: {} }))).toMatch(/Followers of cx:/)
    expect(text(await client.callTool({ name: 'unfollow', arguments: { to: 'cc:happy-cat' } }))).toMatch(/No longer following/)
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

  it('sets the status through the set_status tool', async () => {
    const { client, relay } = await connect('codex-mcp-client')
    const result = await client.callTool({ name: 'set_status', arguments: { state: 'working', task: 'review PR 12' } })
    expect(text(result)).toMatch(/Status set: working: review PR 12/)
    expect(relay.find('PUT', '/v1/sessions/')).toHaveLength(2)
  })

  it('reads the inbox through the inbox tool', async () => {
    const { client, relay } = await connect('codex-mcp-client')
    relay.deliver('cc:happy-cat', 'ping')
    expect(text(await client.callTool({ name: 'inbox', arguments: {} }))).toContain('ping')
  })
})
