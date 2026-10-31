// What the relay sends and takes.

export type AgentState = 'working' | 'blocked' | 'idle' | 'done'
export interface StatusBody { state: AgentState, task: string, blockedOn?: string, waitingFor?: string }
export interface AgentStatus extends StatusBody { at: number }
export interface SessionInfo {
  address: string, online: boolean, lastSeen: number, host: string | null, cwd: string | null, status?: AgentStatus | null
}
export type MessageType = 'note' | 'request'
// fromPerson is the teammate's email (key:<name> for CI), null for the person's own agents. delivery 'prompt'
// means the relay decided it may start work; approved says who allowed that; guidance is the receiver's rules.
export interface InboxMessage {
  id: string, from: string, text: string, sentAt: number, hop?: number, delivery?: 'prompt' | 'context', fromPerson?: string | null
  type?: MessageType, approved?: 'auto' | 'person' | null, guidance?: string
}
export interface TeamInfo { slug: string, name: string, role: string }
export interface TeamAgent { address: string, owner: string, online: boolean, status: AgentStatus | null }
export interface TeamDetail extends TeamInfo { members: Array<{ email: string, role: string }>, agents: TeamAgent[] }
export interface Invite { id: string, team: string, name: string, role: string, invitedBy: string }
export interface Approval { id: string, from: string, fromEmail: string, to: string, text: string, sentAt: number }
export interface Sent { id: string, online: boolean, to?: string, delivery?: 'prompt' | 'context' | 'held' }
export interface ClaimBody { instanceId: string, kind?: string, host?: string, cwd?: string }
export interface SendBody { from: string, instanceId: string, to: string, text: string, hop?: number, type?: MessageType }
