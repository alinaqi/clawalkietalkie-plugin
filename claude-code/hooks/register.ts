import type { Register } from 'claude-code'
import { setStatus, who } from './lib/actions.ts'
import { NOT_READY, onPrompt, onSession, type Box, type On } from './lib/lifecycle.ts'
import { sendMessage } from './lib/send.ts'
import type { Options } from './lib/talkie.ts'

const FAILED = { result: 'clawalkietalkie hit an error; /talkie status shows its state.' }

const readOptions = (options: Readonly<Record<string, unknown>>): Options => ({
  serverUrl: typeof options.serverUrl === 'string' && options.serverUrl ? options.serverUrl : 'https://api.clawalkietalkie.com',
  autoDeliver: options.autoDeliver !== false
})

function onTools (on: On, box: Box): void {
  on('tool.call', { tool: 'mcp__clawalkietalkie__send' }, async ($, e) => {
    const out = { to: String(e.to ?? ''), text: String(e.text ?? ''), isAnswer: true }
    return { result: box.talkie ? await sendMessage($, box.talkie, out) : NOT_READY }
  }).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__who' }, async ($) =>
    ({ result: box.talkie ? await who($, box.talkie) : NOT_READY })).catch(() => FAILED)
  on('tool.call', { tool: 'mcp__clawalkietalkie__set_status' }, async ($, e) =>
    ({ result: box.talkie ? await setStatus($, box.talkie, { ...e }) : NOT_READY })).catch(() => FAILED)
}

export const register: Register = (on, rawOptions) => {
  const box: Box = { options: readOptions(rawOptions) }
  onSession(on, box)
  onPrompt(on, box)
  onTools(on, box)
}
