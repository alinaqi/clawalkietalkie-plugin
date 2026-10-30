// The person's own sessions: claiming a name, the inbox, messages and statuses.

import { enc, pick, type Call } from './relay-core.ts'
import type { ClaimBody, InboxMessage, SendBody, Sent, SessionInfo, StatusBody } from './relay-types.ts'

export const sessionCalls = (call: Call) => ({
  claim: (name: string, body: ClaimBody) => pick<string>(call('PUT', `/v1/sessions/${enc(name)}`, body), 'address'),
  unclaim: (name: string, instanceId: string) => call<object>('DELETE', `/v1/sessions/${enc(name)}`, { instanceId }),
  list: () => pick<SessionInfo[]>(call('GET', '/v1/sessions'), 'sessions'),
  send: (body: SendBody) => call<Sent>('POST', '/v1/messages', body),
  setStatus: (name: string, body: StatusBody & { instanceId: string }) => call<object>('PUT', `/v1/sessions/${enc(name)}/status`, body),
  inbox: (name: string, instanceId: string, wait: number) =>
    pick<InboxMessage[]>(call('GET', `/v1/inbox/${enc(name)}?instanceId=${enc(instanceId)}&wait=${wait}`), 'messages'),
  ack: (name: string, instanceId: string, ids: readonly string[]) =>
    call<object>('POST', `/v1/inbox/${enc(name)}/ack`, { instanceId, ids })
})
