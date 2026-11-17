// An agent's status, checked as the relay checks it (state, and one-line texts of 1–200 characters).
import { ClawalkietalkieError } from './errors.ts'
import type { AgentStatus } from './types.ts'

const STATES = new Set(['working', 'blocked', 'idle', 'done'])
const MAX = 200

const invalid = (message: string): ClawalkietalkieError => new ClawalkietalkieError(0, 'invalid_request', { message })

const line = (value: string | undefined, field: string): string | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length > MAX) throw invalid(`${field} is at most ${MAX} characters`)
  return trimmed || undefined
}

export const checkStatus = (status: AgentStatus): Omit<AgentStatus, 'at'> => {
  if (!STATES.has(status.state)) throw invalid('state is working, blocked, idle or done')
  const task = line(status.task, 'task')
  if (!task) throw invalid('task is required')
  const extra = Object.entries({ blockedOn: line(status.blockedOn, 'blockedOn'), waitingFor: line(status.waitingFor, 'waitingFor') })
  return { state: status.state, task, ...Object.fromEntries(extra.filter(([, v]) => v !== undefined)) }
}
