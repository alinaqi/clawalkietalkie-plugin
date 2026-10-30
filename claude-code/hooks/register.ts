import type { EngineInterface, Register } from 'claude-code'
import { connect, sendMessage, who } from './lib/actions.ts'
import { runTalkie } from './lib/commands.ts'
import { stopListening } from './lib/listener.ts'
import { loadTalkie, relayOf, showStatus, type Options, type Talkie } from './lib/talkie.ts'
import { SEND_TOOL, WHO_TOOL } from './lib/tools.ts'

const NOT_READY = 'clawalkietalkie is still starting; try again in a moment.'
const KEEPS_NAME = new Set(['clear', 'resume'])
const FAILED = { result: 'clawalkietalkie hit an error; /talkie status shows its state.' }

const readOptions = (options: Readonly<Record<string, unknown>>): Options => ({
  serverUrl: typeof options.serverUrl === 'string' && options.serverUrl ? options.serverUrl : 'https://clawalkietalkie-relay.onrender.com',
  autoDeliver: options.autoDeliver !== false
})

const lastSegment = (cwd: string): string => cwd.split('/').filter(Boolean).at(-1) ?? ''

async function boot ($: EngineInterface, options: Options, cwd: string): Promise<Talkie> {
  await $.command.register({
    name: 'talkie',
    description: 'Message your other Claude Code sessions by cc: address',
    argumentHint: '[login|verify|who|send|name|on|off|status|logout]'
  })
  await $.tool.register(SEND_TOOL)
  await $.tool.register(WHO_TOOL)
  const talkie = await loadTalkie($, options, lastSegment(cwd))
  if (talkie.auth) await connect($, talkie)
  else showStatus($, talkie)
  return talkie
}

export const register: Register = (on, rawOptions) => {
  const options = readOptions(rawOptions)
  let talkie: Talkie | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    talkie = await boot($, options, e.cwd)
    return started
  })

  // A prompt the person (not this plugin) submits starts a fresh chain of messages.
  on('prompt.submit', ($, e, next) => {
    if (talkie && e.origin.kind !== 'plugin') talkie.turnHop = 0
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'talkie' }, async ($, e) =>
    ({ text: talkie ? await runTalkie($, talkie, e.args) : NOT_READY }))

  on('tool.call', { tool: 'mcp__clawalkietalkie__send' }, async ($, e) => {
    const out = { to: String(e.to ?? ''), text: String(e.text ?? ''), hop: talkie?.turnHop ?? 0 }
    return { result: talkie ? await sendMessage($, talkie, out) : NOT_READY }
  }).catch(() => FAILED)

  on('tool.call', { tool: 'mcp__clawalkietalkie__who' }, async ($) =>
    ({ result: talkie ? await who($, talkie) : NOT_READY })).catch(() => FAILED)

  on('session.end', async ($, e, next) => {
    if (talkie?.auth && !KEEPS_NAME.has(e.reason)) {
      stopListening($, talkie)
      await relayOf($, talkie).unclaim(talkie.identity.name, talkie.identity.instanceId)
    }
    return next(e)
  })
}
