// What the relay sends and takes.

export type AgentState = 'working' | 'blocked' | 'idle' | 'done'
export interface StatusBody { state: AgentState, task: string, blockedOn?: string, waitingFor?: string }
export interface AgentStatus extends StatusBody { at: number }
export interface SessionInfo {
  address: string, online: boolean, lastSeen: number, host: string | null, cwd: string | null, status?: AgentStatus | null, closed?: boolean, streaming?: boolean
}
export type MessageType = 'note' | 'request'
// fromPerson is the teammate's email (key:<name> for CI), null for the person's own agents. delivery 'prompt'
// means the relay decided it may start work; approved says who allowed that; guidance is the receiver's rules.
// A reply carries replyTo, the id of the message it answers, and thread, the id its conversation began with.
export interface InboxMessage {
  id: string, from: string, text: string, sentAt: number, hop?: number, delivery?: 'prompt' | 'context', fromPerson?: string | null
  type?: MessageType, approved?: 'auto' | 'person' | null, guidance?: string, replyTo?: string, thread?: string
  files?: InboxFile[]
  // Set by the mod: where each file was saved on this machine, or why it was not.
  saved?: SavedFile[]
}
export interface InboxFile { id: string, name: string, size: number, mime: string, sha256: string, formulas?: boolean }
export interface SavedFile { name: string, mime: string, size: number, path?: string, error?: string }
// One read of the inbox: what waits after `after`, and the cursor to read on from (null with nothing yet).
export interface InboxPage { messages: InboxMessage[], cursor: string | null }
export interface InboxQuery { instanceId: string, wait: number, after?: string }
export interface TeamInfo { slug: string, name: string, role: string }
export interface TeamAgent { address: string, owner: string, online: boolean, status: AgentStatus | null }
export interface TeamDetail extends TeamInfo { members: Array<{ email: string, role: string }>, agents: TeamAgent[] }
export interface Invite { id: string, team: string, name: string, role: string, invitedBy: string }
export interface Approval { id: string, from: string, fromEmail: string, to: string, text: string, sentAt: number }
// notice: the relay's word on a team agent of another account (whose it is); shown as is.
export interface Sent {
  id: string, online: boolean, closed?: boolean, ownerNotified?: boolean, notice?: string, to?: string, delivery?: 'prompt' | 'context' | 'held', type?: MessageType, status?: 'queued' | 'held', thread?: string
}
// client: the product id (claude-code, codex); the relay assigns its prefix.
export interface ClaimBody { instanceId: string, kind?: string, client?: string, host?: string, cwd?: string }
// replyTo: the id of a message this agent received, answered here; the relay checks it is addressed to that sender.
export interface SendBody { from: string, instanceId: string, to: string, text: string, hop?: number, type?: MessageType, replyTo?: string, about?: string, files?: string[] }
// Update streams: an agent's short progress posts (kind post) and, when it publishes them, its status changes.
export type UpdateKind = 'post' | 'status'
export interface Update { id: number, from: string, kind: UpdateKind, text: string, at: number }
// One read of the feed: the updates after `after`, and the cursor to read on from (always set).
export interface UpdatesPage { updates: Update[], cursor: string }
export interface UpdatesQuery { instanceId: string, wait: number, after?: string }
export interface Streaming { on: boolean, includeStatus: boolean }
// active: false while the publisher is not streaming or out of reach; the follow resumes by itself.
export interface Follow { to: string, since: number, active: boolean }
export interface Follower { address: string, since: number }
// blocked: followers this agent removed, who cannot follow it again until it unblocks them.
export interface Followers { followers: Follower[], blocked: Follower[] }
