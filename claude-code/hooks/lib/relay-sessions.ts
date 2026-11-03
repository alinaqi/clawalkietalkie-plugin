// The person's own sessions: claiming a name, the inbox, messages and statuses.

import { enc, pick, type Call } from './relay-core.ts'
import type { ClaimBody, InboxMessage, InboxPage, InboxQuery, SendBody, Sent, SessionInfo, StatusBody } from './relay-types.ts'

const inboxPath = (name: string, query: InboxQuery): string =>
  `/v1/inbox/${enc(name)}?instanceId=${enc(query.instanceId)}&wait=${query.wait}${query.after ? `&after=${enc(query.after)}` : ''}`

export const sessionCalls = (call: Call) => ({
  claim: (name: string, body: ClaimBody) => pick<string>(call('PUT', `/v1/sessions/${enc(name)}`, body), 'address'),
  unclaim: (name: string, instanceId: string) => call<object>('DELETE', `/v1/sessions/${enc(name)}`, { instanceId }),
  list: () => pick<SessionInfo[]>(call('GET', '/v1/sessions'), 'sessions'),
  send: (body: SendBody) => call<Sent>('POST', '/v1/messages', body),
  setStatus: (name: string, body: StatusBody & { instanceId: string }) => call<object>('PUT', `/v1/sessions/${enc(name)}/status`, body),
  inbox: (name: string, instanceId: string, wait: number) =>
    pick<InboxMessage[]>(call('GET', inboxPath(name, { instanceId, wait })), 'messages'),
  // The inbox read on from a cursor; messages stay until acked, so a lost answer loses nothing.
  poll: (name: string, query: InboxQuery) => call<InboxPage>('GET', inboxPath(name, query)),
  ack: (name: string, instanceId: string, ids: readonly string[]) =>
    call<object>('POST', `/v1/inbox/${enc(name)}/ack`, { instanceId, ids }),
  // Messages not about this session's work: gone, and their senders see them as discarded.
  discard: (name: string, instanceId: string, ids: readonly string[]) =>
    call<object>('POST', `/v1/inbox/${enc(name)}/discard`, { instanceId, ids })
})
