// The update-stream tools' calls.

import type { Box, On } from './lifecycle.ts'
import { NOT_READY } from './lifecycle.ts'
import { follow, followers, following, postUpdate, setStreaming, unfollow } from './streams.ts'

const FAILED = { result: 'clawalkietalkie hit an error; /talkie status shows its state.' }
const flag = (value: unknown): boolean => value === true || value === 'true'

export function onStreamTools (on: On, box: Box): void {
  on('tool.call', { tool: 'mcp__clawalkietalkie__stream_updates' }, async ($, e) => {
    const input = { on: flag(e.on), ...(e.include_status === undefined ? {} : { includeStatus: flag(e.include_status) }) }
    return { result: box.talkie ? await setStreaming($, box.talkie, input) : NOT_READY }
  }).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__post_update' }, async ($, e) =>
    ({ result: box.talkie ? await postUpdate($, box.talkie, String(e.text ?? '')) : NOT_READY })).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__follow' }, async ($, e) =>
    ({ result: box.talkie ? await follow($, box.talkie, String(e.to ?? '')) : NOT_READY })).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__unfollow' }, async ($, e) =>
    ({ result: box.talkie ? await unfollow($, box.talkie, String(e.to ?? '')) : NOT_READY })).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__following' }, async ($) =>
    ({ result: box.talkie ? await following($, box.talkie) : NOT_READY })).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__followers' }, async ($) =>
    ({ result: box.talkie ? await followers($, box.talkie) : NOT_READY })).catch(() => FAILED)
}
