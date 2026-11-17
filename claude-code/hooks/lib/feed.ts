// The updates feed: long-poll the followed agents' updates from a cursor kept per identity in $.store, keep them
// until the person's next prompt, and count them in the status line. They never start a turn. Runs only while this
// session follows an agent, so a relay without update streams is never polled for them.

import type { EngineInterface } from 'claude-code'
import { jitter, nextBackoff } from './backoff.ts'
import type { Identity, Talkie } from './talkie.ts'
import { relayOf, showStatus } from './talkie.ts'
import type { Update } from './relay-types.ts'
import { frameUpdates } from './updates-frame.ts'

const WAIT_SECONDS = 25
const GAP_MS = 250
const MAX_BACKOFF_MS = 30_000
// Unshown updates kept at most; the oldest go first. Only the 5 newest per publisher are shown anyway.
const MAX_KEPT = 100

export const feedKey = (identity: Identity): string => `updates:${identity.name}:${identity.instanceId}`

function schedule ($: EngineInterface, t: Talkie, ms: number): void {
  t.feed.timer?.cancel()
  t.feed.timer = $.clock.after(ms, () => { void tick($, t) })
}

async function saveFeedCursor ($: EngineInterface, t: Talkie, cursor: string | undefined): Promise<void> {
  if (cursor === t.feed.cursor) return
  t.feed.cursor = cursor
  if (cursor) await $.store.set(feedKey(t.identity), cursor)
  else await $.store.delete(feedKey(t.identity))
}

function keep (t: Talkie, updates: readonly Update[]): void {
  const known = new Set(t.updates.map((u) => u.id))
  t.updates.push(...updates.filter((u) => !known.has(u.id)))
  t.updates.splice(0, Math.max(0, t.updates.length - MAX_KEPT))
}

async function fail ($: EngineInterface, t: Talkie, status: number): Promise<void> {
  if (status === 400 && t.feed.cursor) {
    await saveFeedCursor($, t, undefined)
    return schedule($, t, 0)
  }
  // Signed out, the name taken over (the inbox loop says so), or no update streams on this relay.
  if (status === 401 || status === 403 || status === 404) return stopFeed($, t)
  t.feed.backoffMs = nextBackoff(t.feed.backoffMs, MAX_BACKOFF_MS)
  schedule($, t, jitter(t.feed.backoffMs, Math.random))
}

async function tick ($: EngineInterface, t: Talkie): Promise<void> {
  if (!t.feed.on || !t.auth) return
  const identity = t.identity
  const res = await relayOf($, t).updates(identity.name, { instanceId: identity.instanceId, wait: WAIT_SECONDS, after: t.feed.cursor })
  if (!t.feed.on) return
  if (t.identity !== identity) return schedule($, t, 0)
  if (!res.ok) return fail($, t, res.status)
  t.feed.backoffMs = 0
  keep(t, res.value.updates ?? [])
  await saveFeedCursor($, t, res.value.cursor ?? t.feed.cursor)
  if ((res.value.updates ?? []).length > 0) showStatus($, t)
  schedule($, t, GAP_MS)
}

export function startFeed ($: EngineInterface, t: Talkie): void {
  if (t.feed.on) return
  t.feed.on = true
  t.feed.backoffMs = 0
  schedule($, t, 0)
}

export function stopFeed ($: EngineInterface, t: Talkie): void {
  t.feed.on = false
  t.feed.timer?.cancel()
  t.feed.timer = undefined
}

// Starts the feed when this session follows any agent; a refusal (or an older relay) leaves it off.
export async function startFeedIfFollowing ($: EngineInterface, t: Talkie): Promise<void> {
  const res = await relayOf($, t).follows({ from: t.identity.name, instanceId: t.identity.instanceId })
  if (res.ok && (res.value ?? []).length > 0) startFeed($, t)
}

// The updates read since the last prompt, framed as data, to read beside the next one; the count leaves the status.
export function takeUpdates ($: EngineInterface, t: Talkie): string[] {
  if (t.updates.length === 0) return []
  const framed = frameUpdates(t.updates.splice(0), 'this session')
  showStatus($, t)
  return [framed]
}
