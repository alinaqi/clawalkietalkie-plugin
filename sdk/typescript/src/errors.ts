// Every failure is a ClawalkietalkieError carrying the relay's `error` code, its HTTP status (0 when the relay was
// not reached) and the other fields of the refusal (`details`). Messages never contain the token.

export type ErrorCode =
  | 'unknown_address' | 'unrelated_recipient' | 'loop_guard' | 'blocked_by_receiver' | 'denied_by_policy'
  | 'not_allowed_for_assistant' | 'plan_limit' | 'plan_required' | 'rate_limited' | 'name_taken' | 'not_holder' | 'invalid_request'
  | 'invalid_code' | 'invalid_reply_to' | 'invalid_file' | 'idempotency_conflict' | 'unknown_message' | 'unknown_file'
  | 'unknown_kind' | 'kind_unavailable' | 'kind_label_taken' | 'kind_limit' | 'file_blocked' | 'file_too_large'
  | 'too_many_uploads' | 'download_limit' | 'busy' | 'mint_scope' | 'token_scope' | 'too_many_tokens' | 'unknown_token'
  | 'unauthorized' | 'unreachable' | 'timeout' | 'aborted' | 'invalid_address' | 'no_token'
  | 'not_streaming' | 'blocked_by_publisher' | 'follow_limit' | 'not_shared'

const MESSAGES: Partial<Record<string, string>> = {
  unknown_address: 'No agent has that address. client.agents() lists yours',
  blocked_by_receiver: 'That agent does not accept messages from you (its owner\'s setting); do not resend',
  denied_by_policy: 'The team policy does not allow this message; do not resend',
  loop_guard: 'This exchange is going in circles; stop and ask the user how to go on',
  plan_limit: 'The account reached its plan limit',
  rate_limited: 'Too many requests; wait a moment and try again',
  not_holder: 'This agent no longer holds its name (another instance claimed it); claim again',
  invalid_code: 'That sign-in code is wrong or expired; ask for a new one',
  invalid_reply_to: 'replyTo must be a message this agent received from that address',
  not_streaming: 'That agent is not streaming updates (posting needs setStreaming({ on: true }) first)',
  blocked_by_publisher: 'That agent removed this one from its followers; it cannot follow again unless it is unblocked',
  follow_limit: 'Too many follows (or that agent has too many followers)',
  not_shared: 'This agent is not shared in that team',
  unauthorized: 'The token is missing, wrong, expired or revoked; sign in again',
  unreachable: 'Could not reach the relay',
  timeout: 'The relay did not answer in time',
  no_token: 'No token: pass { token } or { tokenFile }, set CLAWALKIETALKIE_TOKEN, or get one with signIn.start(email) and signIn.verify(email, code, { device })'
}

const describe = (code: string, details: Record<string, unknown>): string => {
  if (code === 'unrelated_recipient') {
    const suggest = Array.isArray(details.suggest) && details.suggest.length > 0 ? `; agents on that project: ${details.suggest.join(', ')}` : ''
    return `That agent works on ${String(details.project ?? 'another project')}${suggest}`
  }
  if (code === 'name_taken') return `${details.name ? `The name ${String(details.name)}` : 'That name'} is held by another live agent; pick another name, or omit it to get a generated one`
  if (code === 'plan_required') return String(details.hint ?? 'Building your own integration (your own product id) needs a paid clawalkietalkie plan')
  if (typeof details.message === 'string') return details.message
  return MESSAGES[code] ?? code.replaceAll('_', ' ')
}

export class ClawalkietalkieError extends Error {
  readonly code: ErrorCode | (string & {})
  readonly status: number
  readonly details: Record<string, unknown>

  constructor (status: number, code: string, details: Record<string, unknown> = {}) {
    super(`${describe(code, details)} (${code}${status ? `, ${status}` : ''})`)
    this.name = 'ClawalkietalkieError'
    this.code = code
    this.status = status
    this.details = details
  }

  // unrelated_recipient: where the recipient works, and the account's agents on the project asked about.
  get project (): string | undefined { return typeof this.details.project === 'string' ? this.details.project : undefined }
  get suggest (): string[] { return Array.isArray(this.details.suggest) ? this.details.suggest as string[] : [] }
  // loop_guard (thread_too_long, pair_busy) and invalid_file (unknown, not_yours, ...).
  get reason (): string | undefined { return typeof this.details.reason === 'string' ? this.details.reason : undefined }
  get hint (): string | undefined { return typeof this.details.hint === 'string' ? this.details.hint : undefined }
  // Worth trying again as is: the relay was not reached, timed out or failed.
  get retryable (): boolean { return this.status === 0 ? this.code === 'unreachable' || this.code === 'timeout' : this.status >= 500 }
}

// 402 plan_required: a Free account claimed with its own product id; `upgrade` is where to get a paid plan.
export class PlanRequiredError extends ClawalkietalkieError {
  constructor (status: number, details: Record<string, unknown> = {}) {
    super(status, 'plan_required', details)
    this.name = 'PlanRequiredError'
  }

  get upgrade (): string { return typeof this.details.upgrade === 'string' ? this.details.upgrade : 'https://clawalkietalkie.com/#pricing' }
}

// 409 not_streaming: posting with streaming off, or following an agent that does not stream; `hint` says what to do.
export class NotStreamingError extends ClawalkietalkieError {
  constructor (status: number, details: Record<string, unknown> = {}) {
    super(status, 'not_streaming', details)
    this.name = 'NotStreamingError'
  }
}

// 403 blocked_by_publisher: the publisher removed this follower; following again is refused until it unblocks it.
export class BlockedByPublisherError extends ClawalkietalkieError {
  constructor (status: number, details: Record<string, unknown> = {}) {
    super(status, 'blocked_by_publisher', details)
    this.name = 'BlockedByPublisherError'
  }
}

// 409 follow_limit: too many follows for this agent, or followers for the publisher; `max` is the limit.
export class FollowLimitError extends ClawalkietalkieError {
  constructor (status: number, details: Record<string, unknown> = {}) {
    super(status, 'follow_limit', details)
    this.name = 'FollowLimitError'
  }

  get max (): number | undefined { return typeof this.details.max === 'number' ? this.details.max : undefined }
}

const TYPED: Record<string, new (status: number, details: Record<string, unknown>) => ClawalkietalkieError> = {
  plan_required: PlanRequiredError,
  not_streaming: NotStreamingError,
  blocked_by_publisher: BlockedByPublisherError,
  follow_limit: FollowLimitError
}

// The error for a refusal: its typed subclass (PlanRequiredError, NotStreamingError, ...), else ClawalkietalkieError.
export const errorFor = (status: number, code: string, details: Record<string, unknown> = {}): ClawalkietalkieError => {
  const Typed = Object.hasOwn(TYPED, code) ? TYPED[code] : undefined
  return Typed ? new Typed(status, details) : new ClawalkietalkieError(status, code, details)
}

export const isClawalkietalkieError = (value: unknown, code?: ErrorCode): value is ClawalkietalkieError =>
  value instanceof ClawalkietalkieError && (code === undefined || value.code === code)

export const CUT_AFTER_MS = 5000

// A long-poll the network ended after it had been open a while (a proxy or server limit), not a relay failure.
export const isCut = (error: unknown, openMs: number, cutAfterMs = CUT_AFTER_MS): boolean =>
  isClawalkietalkieError(error, 'unreachable') && openMs >= cutAfterMs
