// The inbox cursor: read on from it, and kept on disk only while nothing read waits to be shown, so a
// restart never skips a message the agent has not seen (the relay keeps each until it is acked).
import { saveCursor } from './config.ts'
import type { AgentState } from './state.ts'

export const cursorKey = (s: AgentState): string => `${s.identity.name}:${s.identity.instanceId}`

// Takes the cursor a poll answered with; stores it once the buffer is empty.
export const keepCursor = (s: AgentState, cursor: string | undefined): void => {
  s.cursor = cursor
  if (s.buffer.length === 0) saveCursor(s.deps.dir, cursorKey(s), cursor)
}
