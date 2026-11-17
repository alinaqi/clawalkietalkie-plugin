// Signing in by email: a 6-digit code is mailed, then traded for a device token. Nothing is stored.
import { request, type FetchLike, DEFAULT_TIMEOUT_MS } from './http.ts'
import { resolveServer } from './token.ts'

export interface SignInOptions { server?: string, fetch?: FetchLike }
export interface VerifyOptions extends SignInOptions { device: string }

const wireOf = (options: SignInOptions = {}) =>
  ({ server: resolveServer(options.server), fetch: options.fetch ?? globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS })

export const signIn = {
  // Always answers (the relay never says whether an account exists).
  start: async (email: string, options?: SignInOptions): Promise<void> => {
    await request(wireOf(options), { method: 'POST', path: '/v1/auth/otp', json: { email: email.trim() } })
  },
  // device: what this token is for, shown on the board (≤ 100 characters), like 'my-app@laptop'.
  verify: (email: string, code: string, options: VerifyOptions): Promise<{ token: string, email: string }> =>
    request(wireOf(options), { method: 'POST', path: '/v1/auth/verify', json: { email: email.trim(), code: code.trim(), device: options.device } })
}
