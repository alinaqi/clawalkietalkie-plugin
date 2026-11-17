// What the relay answers, as the SDK hands it on.

export type MessageType = 'note' | 'request'
export type AgentState = 'working' | 'blocked' | 'idle' | 'done'
export type MessageStatus = 'queued' | 'delivered' | 'held' | 'refused' | 'discarded' | 'replied' | 'expired'

export interface Me { kind: 'person' | 'key', email?: string, name?: string, team?: string, address?: string }

export interface AgentStatus { state: AgentState, task: string, blockedOn?: string, waitingFor?: string, at?: number }

export interface AgentInfo {
  address: string, online: boolean, lastSeen: number, host: string | null, cwd: string | null, status?: AgentStatus | null, closed?: boolean
}

export interface KindInfo { kind: string, product: string | null, label: string, builtIn: boolean, verified: boolean }

export interface ActivityEvent {
  id: number, messageId: string, at: number, from: string, to: string, type: MessageType, delivery: string, inbound: boolean, text?: string
}
export interface ActivityPage { events: ActivityEvent[], cursor: string }

export interface DeviceToken { id: string, device: string, createdAt: number, expiresAt: number, minted: boolean, current: boolean }
export interface MintedToken { id: string, token: string, device: string }

export interface FileInfo { id: string, name: string, size: number, mime: string, sha256: string, formulas?: boolean }
export interface UploadedFile extends FileInfo { status: string, createdAt: number, reason?: string }

// delivery: how the receiver gets it (prompt, context, or held for its person); ownerNotified: the owner was emailed.
export interface SentMessage {
  id: string, online: boolean, to: string, delivery: 'prompt' | 'context' | 'held', type: MessageType, status: 'queued' | 'held'
  thread: string, closed?: boolean, ownerNotified?: boolean, notice?: string
}

export interface Reply { id: string, from: string, text: string, sentAt: number, files?: FileInfo[] }

export interface MessageStatusView {
  id: string, status: MessageStatus, deliveredAt: number | null, replyTo: string | null, thread: string, replies: Reply[]
}

export interface ReplyWait { replies: Reply[], status: MessageStatus, timedOut: boolean }

// A message as the inbox lists it. fromPerson: a teammate's email (key:<name> for CI), null for the account's own agents.
export interface InboxMessage {
  id: string, from: string, text: string, sentAt: number, hop?: number, delivery?: 'prompt' | 'context', fromPerson?: string | null
  type?: MessageType, approved?: 'auto' | 'person' | null, guidance?: string, replyTo?: string, thread?: string, files?: FileInfo[]
}

export interface InboxPage { messages: InboxMessage[], cursor: string | null }

export interface SendOptions { type?: MessageType, about?: string, replyTo?: string, files?: string[], hop?: number, signal?: AbortSignal }
