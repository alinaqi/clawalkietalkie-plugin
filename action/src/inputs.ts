// The action's inputs, as GitHub hands them to a step: INPUT_<NAME> environment variables.
export interface Inputs { key: string, to: string, text: string, server: string, waitSeconds: number }

const DEFAULT_SERVER = 'https://clawalkietalkie-relay.onrender.com'
const MAX_WAIT_SECONDS = 3600

const required = (env: Record<string, string | undefined>, name: string): string => {
  const value = env[`INPUT_${name.toUpperCase()}`]?.trim()
  if (!value) throw new Error(`The ${name} input is required.`)
  return value
}

export const readInputs = (env: Record<string, string | undefined>): Inputs => {
  const key = required(env, 'key')
  if (!key.startsWith('cwk_')) throw new Error('The key input must be a team key (cwk_…), made by a team admin.')
  const wait = Number(env.INPUT_WAIT_SECONDS ?? 0)
  return {
    key,
    to: required(env, 'to'),
    text: required(env, 'text'),
    server: env.INPUT_SERVER?.trim() || DEFAULT_SERVER,
    waitSeconds: Number.isFinite(wait) ? Math.min(Math.max(0, Math.floor(wait)), MAX_WAIT_SECONDS) : 0
  }
}
