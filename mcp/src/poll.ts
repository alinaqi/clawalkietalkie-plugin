// The loop that keeps an agent online: long-poll its inbox, notify the client of what arrived, poll again;
// errors back off, doubling from 1 s to 30 s with ±20% jitter, and resume from the cursor.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jitter, nextBackoff } from '../../claude-code/hooks/lib/backoff.ts'
import type { Agent } from './agent.ts'

const WAIT_SECONDS = 25
const GAP_MS = 250
const SIGNED_OUT_MS = 5000
const MAX_BACKOFF_MS = 30_000

export interface Retry { ok: boolean, backoffMs: number }

// How long to wait before the next poll, and the backoff to carry; `random` is like Math.random.
export const retryDelay = (last: Retry, random: () => number): { delayMs: number, backoffMs: number } => {
  if (last.ok) return { delayMs: GAP_MS, backoffMs: 0 }
  const backoffMs = nextBackoff(last.backoffMs, MAX_BACKOFF_MS)
  return { delayMs: jitter(backoffMs, random), backoffMs }
}

export const pollForever = (server: McpServer, agent: Agent, isOpen: () => boolean): void => {
  let backoffMs = 0
  const tick = async (): Promise<void> => {
    if (!isOpen()) return
    const before = agent.pending()
    const ok = await agent.pollOnce(agent.isSignedIn() ? WAIT_SECONDS : 0).catch(() => false)
    const arrived = agent.pending() - before
    if (arrived > 0) await server.sendLoggingMessage({ level: 'notice', data: `📻 ${arrived} new message(s); call inbox.` }).catch(() => {})
    const next = agent.isSignedIn() ? retryDelay({ ok, backoffMs }, Math.random) : { delayMs: SIGNED_OUT_MS, backoffMs: 0 }
    backoffMs = next.backoffMs
    setTimeout(() => { void tick() }, next.delayMs)
  }
  void tick()
}
