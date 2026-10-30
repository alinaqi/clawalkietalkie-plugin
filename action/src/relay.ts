// The few relay calls a CI run makes, authenticated with a team key.
export interface Me { name: string, team: string, address: string }
export interface Sent { id: string, to: string, delivery: string }
export interface Incoming { id: string, from: string, text: string }

// A proxy in front of the relay may answer with HTML or plain text: never let that hide the status.
const parseBody = (text: string): Record<string, unknown> => {
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {}
  } catch {
    return { error: text.slice(0, 200) }
  }
}

export const relayClient = (server: string, key: string, fetch: typeof globalThis.fetch) => {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${server.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = parseBody(await res.text())
    if (!res.ok) throw new Error(`The relay answered ${res.status}: ${String(json.error ?? 'error')}`)
    return json as T
  }
  return {
    me: () => call<Me>('GET', '/v1/me'),
    claim: (name: string, instanceId: string) => call('PUT', `/v1/sessions/${name}`, { instanceId, kind: 'gh', host: 'github-actions' }),
    send: (input: { from: string, instanceId: string, to: string, text: string }) => call<Sent>('POST', '/v1/messages', { ...input, hop: 0 }),
    inbox: (name: string, instanceId: string, wait: number) =>
      call<{ messages: Incoming[] }>('GET', `/v1/inbox/${name}?instanceId=${instanceId}&wait=${wait}`),
    ack: (name: string, instanceId: string, ids: string[]) => call('POST', `/v1/inbox/${name}/ack`, { instanceId, ids })
  }
}

export type RelayClient = ReturnType<typeof relayClient>
