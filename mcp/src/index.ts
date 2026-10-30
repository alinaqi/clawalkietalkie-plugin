// clawalkietalkie-mcp [--kind cx] [--server URL]: the MCP server over stdio.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAgent } from './agent.ts'
import { defaultDir } from './config.ts'
import { createServer } from './server.ts'

const DEFAULT_SERVER = 'https://api.clawalkietalkie.com'

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const fetchText = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init)
  return { status: res.status, ok: res.ok, text: await res.text() }
}

const agent = createAgent({
  fetch: fetchText,
  dir: defaultDir(),
  serverUrl: flag('server') ?? process.env.CLAWALKIETALKIE_SERVER ?? DEFAULT_SERVER,
  cwd: process.cwd()
})

await createServer(agent, { kind: flag('kind') ?? process.env.CLAWALKIETALKIE_KIND }).connect(new StdioServerTransport())
