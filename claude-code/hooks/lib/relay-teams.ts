// Teams: membership, sharing an agent, invites and held messages.

import { enc, pick, type Call } from './relay-core.ts'
import type { Approval, Invite, TeamDetail, TeamInfo } from './relay-types.ts'

export const teamCalls = (call: Call) => ({
  teams: () => pick<TeamInfo[]>(call('GET', '/v1/teams'), 'teams'),
  team: (slug: string) => call<TeamDetail>('GET', `/v1/teams/${enc(slug)}`),
  share: (slug: string, name: string) => pick<string>(call('PUT', `/v1/teams/${enc(slug)}/agents/${enc(name)}`, {}), 'address'),
  unshare: (slug: string, name: string) => call<object>('DELETE', `/v1/teams/${enc(slug)}/agents/${enc(name)}`),
  invites: () => pick<Invite[]>(call('GET', '/v1/invites'), 'invites'),
  accept: (id: string) => call<TeamInfo>('POST', `/v1/invites/${enc(id)}/accept`),
  approvals: () => pick<Approval[]>(call('GET', '/v1/approvals'), 'approvals'),
  decide: (id: string, decision: 'allow' | 'deny') => call<object>('POST', `/v1/approvals/${enc(id)}`, { decision })
})
