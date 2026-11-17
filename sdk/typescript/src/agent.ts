// One agent on the network: an address it claims, then sends, listens, and closes.
import { randomBytes } from 'node:crypto'
import { generateName, isValidName } from './address.ts'
import { ClawalkietalkieError, isClawalkietalkieError } from './errors.ts'
import { download, upload, type FileSource, type Holder } from './files.ts'
import { request, enc, type Wire } from './http.ts'
import { createLoop, type Handler, type ListenOptions } from './listen.ts'
import { incoming } from './message.ts'
import { messageStatus, sendMessage, waitForReply, type WaitOptions } from './messaging.ts'
import { checkStatus } from './status.ts'
import type { AgentStatus, InboxPage, MessageStatusView, ReplyWait, SendOptions, SentMessage, UploadedFile } from './types.ts'

// client: your product id ([a-z0-9][a-z0-9-]{1,31}); the relay assigns its prefix. name: generated when omitted.
// instanceId: keep it across restarts to take the name back at once (another instance holds it for 90 s otherwise).
export interface AgentOptions { client: string, name?: string, label?: string, kind?: string, host?: string, cwd?: string, instanceId?: string }

const GENERATED_TRIES = 5

export class Agent {
  name: string
  readonly instanceId: string
  address: string | undefined
  readonly #wire: Wire
  readonly #options: AgentOptions
  readonly #generated: boolean
  readonly #stops = new Set<() => Promise<void>>()
  #claiming: Promise<string> | undefined

  constructor (wire: Wire, options: AgentOptions) {
    if (options.name !== undefined && !isValidName(options.name)) {
      throw new ClawalkietalkieError(0, 'invalid_address', { message: `"${options.name}" is not a valid name: 1–32 lowercase letters, digits and inner dashes` })
    }
    this.#wire = wire
    this.#options = options
    this.#generated = options.name === undefined
    this.name = options.name ?? generateName(Math.random)
    this.instanceId = options.instanceId ?? randomBytes(16).toString('hex')
  }

  get #holder (): Holder { return { name: this.name, instanceId: this.instanceId } }

  #claimOnce (): Promise<{ address: string }> {
    const { name: _n, instanceId: _i, ...rest } = this.#options
    const json = Object.fromEntries(Object.entries({ instanceId: this.instanceId, ...rest }).filter(([, v]) => v !== undefined))
    return request(this.#wire, { method: 'PUT', path: `/v1/sessions/${enc(this.name)}`, json })
  }

  // Registers the name and answers the address (like ex:bot). A generated name that is taken is replaced.
  async claim (): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        this.address = (await this.#claimOnce()).address
        return this.address
      } catch (error) {
        if (!isClawalkietalkieError(error, 'name_taken')) throw error
        if (!this.#generated || attempt >= GENERATED_TRIES) throw new ClawalkietalkieError(409, 'name_taken', { ...error.details, name: this.name })
        this.name = generateName(Math.random)
      }
    }
  }

  async #ready (): Promise<Holder> {
    if (!this.address) {
      this.#claiming ??= this.claim().finally(() => { this.#claiming = undefined })
      await this.#claiming
    }
    return this.#holder
  }

  async send (to: string, text: string, options: SendOptions = {}): Promise<SentMessage> {
    return sendMessage(this.#wire, await this.#ready(), { to, text, options })
  }

  status (id: string): Promise<MessageStatusView> { return messageStatus(this.#wire, id) }

  waitForReply (id: string, options?: WaitOptions): Promise<ReplyWait> { return waitForReply(this.#wire, id, options) }

  // One read of the inbox: what waits after `after` (long-polling up to `wait` seconds). Messages stay until acked.
  async inbox (query: { after?: string, wait?: number, signal?: AbortSignal } = {}): Promise<InboxPage> {
    const { name, instanceId } = await this.#ready()
    const wait = Math.min(50, Math.max(0, query.wait ?? 0))
    return request(this.#wire, { method: 'GET', path: `/v1/inbox/${enc(name)}`, query: { instanceId, wait, after: query.after }, signal: query.signal, timeoutMs: wait * 1000 + 15_000 })
  }

  async ack (ids: string[]): Promise<void> { await this.#remove('ack', ids) }

  // Drops messages not about this agent's work: they leave the inbox and their senders see `discarded`.
  async discard (ids: string[]): Promise<void> { await this.#remove('discard', ids) }

  async #remove (what: 'ack' | 'discard', ids: string[]): Promise<void> {
    const { name, instanceId } = await this.#ready()
    await request(this.#wire, { method: 'POST', path: `/v1/inbox/${enc(name)}/${what}`, json: { instanceId, ids } })
  }

  // Calls `handler` for every message, one at a time; the answer stops listening.
  listen (handler: Handler, options: ListenOptions = {}): () => Promise<void> {
    const stop = createLoop({
      ready: () => this.#ready(),
      poll: (q) => this.inbox(q),
      ack: (ids) => this.ack(ids),
      wrap: (message, onDiscard) => incoming(this, message, onDiscard)
    }, handler, options)
    const tracked = async (): Promise<void> => { this.#stops.delete(tracked); await stop() }
    this.#stops.add(tracked)
    return tracked
  }

  async setStatus (status: AgentStatus): Promise<void> {
    const body = checkStatus(status)
    const { name, instanceId } = await this.#ready()
    await request(this.#wire, { method: 'PUT', path: `/v1/sessions/${enc(name)}/status`, json: { instanceId, ...body } })
  }

  async uploadFile (source: FileSource, name?: string): Promise<UploadedFile> { return upload(this.#wire, await this.#ready(), { source, name }) }

  async downloadFile (id: string): Promise<Uint8Array> { return download(this.#wire, await this.#ready(), id) }

  // Ends the session: stops listening; the address stays (closed), and messages to it wait 24 h for a claim.
  async close (): Promise<void> {
    await Promise.all([...this.#stops].map((stop) => stop()))
    if (!this.address) return
    await request(this.#wire, { method: 'POST', path: `/v1/sessions/${enc(this.name)}/close`, json: { instanceId: this.instanceId } })
  }
}
