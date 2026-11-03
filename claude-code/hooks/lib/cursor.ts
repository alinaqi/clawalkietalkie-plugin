// The inbox cursor, kept per name and instance: a renamed session reads its new inbox from the start.

import type { EngineInterface } from 'claude-code'
import type { Identity, Talkie } from './talkie.ts'

export const cursorKey = (identity: Identity): string => `cursor:${identity.name}:${identity.instanceId}`

export async function saveCursor ($: EngineInterface, t: Talkie, cursor: string | undefined): Promise<void> {
  if (cursor === t.cursor) return
  t.cursor = cursor
  if (cursor) await $.store.set(cursorKey(t.identity), cursor)
  else await $.store.delete(cursorKey(t.identity))
}
