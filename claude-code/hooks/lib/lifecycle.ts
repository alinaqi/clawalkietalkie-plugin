// The session's lifecycle hooks: start and end, the person's prompts, and /talkie.

import type { EngineInterface, Register } from 'claude-code'
import { connect } from './actions.ts'
import { runTalkie } from './commands.ts'
import { folderName } from './frame.ts'
import { readMessage } from './hops.ts'
import { stopListening } from './listener.ts'
import { loadTalkie, relayOf, showStatus, type Options, type Talkie } from './talkie.ts'
import { SEND_TOOL, SET_STATUS_TOOL, WHO_TOOL } from './tools.ts'

export type On = Parameters<Register>[0]
// The session's state, set once session.start has loaded it.
export interface Box { options: Options, talkie?: Talkie }

export const NOT_READY = 'clawalkietalkie is still starting; try again in a moment.'
const KEEPS_NAME = new Set(['clear', 'resume'])

// Context-only messages that arrived since the last prompt, framed, to read beside it.
const takeContext = (t: Talkie): string[] => t.context.splice(0).map((m) => readMessage(t, m))

async function boot ($: EngineInterface, options: Options, cwd: string): Promise<Talkie> {
  await $.command.register({
    name: 'talkie',
    description: 'Message your other coding agents (cc:, cx:, …) and your teammates\' agents by address',
    argumentHint: '[login|verify|who|send|ask|name|inbox|teams|join|share|unshare|approvals|approve|deny|autoapprove|on|off|status|logout]'
  })
  await $.tool.register(SEND_TOOL)
  await $.tool.register(WHO_TOOL)
  await $.tool.register(SET_STATUS_TOOL)
  const talkie = await loadTalkie($, options, folderName(cwd))
  if (talkie.auth) await connect($, talkie)
  else showStatus($, talkie)
  return talkie
}

async function endSession ($: EngineInterface, t: Talkie | undefined, reason: string): Promise<void> {
  if (!t?.auth || KEEPS_NAME.has(reason)) return
  stopListening($, t)
  await relayOf($, t).unclaim(t.identity.name, t.identity.instanceId)
}

export function onSession (on: On, box: Box): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    box.talkie = await boot($, box.options, e.cwd)
    return started
  })
  on('session.end', async ($, e, next) => {
    await endSession($, box.talkie, e.reason)
    return next(e)
  })
}

// A prompt the person (not this plugin) submits carries the context-only messages that arrived since.
export function onPrompt (on: On, box: Box): void {
  on('prompt.submit', ($, e, next) => {
    if (!box.talkie || e.origin.kind === 'plugin') return next(e)
    const context = e.command ? [] : takeContext(box.talkie)
    return next(context.length > 0 ? { ...e, context: [...(e.context ?? []), ...context] } : e)
  }).catch(($, e, next) => next(e))
  on('command.run', { command: 'talkie' }, async ($, e) =>
    ({ text: box.talkie ? await runTalkie($, box.talkie, e.args) : NOT_READY }))
}
