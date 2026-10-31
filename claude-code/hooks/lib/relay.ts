// A typed client for the relay API. Takes the fetch to use, so it runs on $.http.fetch.
// The MCP server bundles this file and the relay-*.ts files beside it.

import { createCall, type Fetch, type RelayConfig } from './relay-core.ts'
import { sessionCalls } from './relay-sessions.ts'
import { teamCalls } from './relay-teams.ts'

export type { Fetch, FetchInit, RelayConfig, Result } from './relay-core.ts'
export type {
  AgentState, AgentStatus, Approval, ClaimBody, InboxMessage, Invite, MessageType, SendBody, Sent, SessionInfo, StatusBody, TeamAgent, TeamDetail, TeamInfo
} from './relay-types.ts'

export const createRelay = (fetch: Fetch, config: RelayConfig) => {
  const call = createCall(fetch, config)
  return {
    requestCode: (email: string) => call<object>('POST', '/v1/auth/otp', { email }),
    verify: (body: { email: string, code: string, device: string }) =>
      call<{ token: string, email: string }>('POST', '/v1/auth/verify', body),
    revoke: () => call<object>('DELETE', '/v1/auth/token'),
    autoApprove: () => call<{ on: boolean }>('GET', '/v1/settings/auto-approve'),
    setAutoApprove: (on: boolean) => call<{ on: boolean }>('PUT', '/v1/settings/auto-approve', { on }),
    ...sessionCalls(call),
    ...teamCalls(call)
  }
}

export type Relay = ReturnType<typeof createRelay>

// The web UI for teams, approvals, sharing and statuses.
export const boardUrl = (serverUrl: string): string => `${serverUrl.replace(/\/+$/, '')}/board`
