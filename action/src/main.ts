// The action's work, separate from process globals so it can be tested.
import { randomUUID } from 'node:crypto'
import { readInputs } from './inputs.ts'
import { writeOutputs } from './outputs.ts'
import { run } from './run.ts'

export interface MainDeps {
  env: Record<string, string | undefined>
  fetch: typeof globalThis.fetch
  now: () => number
  log: (line: string) => void
}

// The reply is written by an agent: printed between stop-commands markers, it cannot run workflow commands.
const printReply = (log: (line: string) => void, from: string, reply: string): void => {
  const token = `cwt-${randomUUID()}`
  log(`::stop-commands::${token}`)
  log(`Reply from ${from}:`)
  for (const line of reply.split('\n')) log(line)
  log(`::${token}::`)
}

export const main = async ({ env, fetch, now, log }: MainDeps): Promise<number> => {
  try {
    const inputs = readInputs(env)
    log(`::add-mask::${inputs.key}`)
    const outputs = await run({ inputs, fetch, now })
    log(`Sent to ${outputs.to} as ${outputs.from} (${outputs.delivery}).`)
    if (outputs.reply !== undefined) printReply(log, outputs.to, outputs.reply)
    if (env.GITHUB_OUTPUT) writeOutputs(env.GITHUB_OUTPUT, { ...outputs })
    return 0
  } catch (error) {
    log(`::error::${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
