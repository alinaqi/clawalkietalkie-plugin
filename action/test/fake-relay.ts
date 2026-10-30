// A fetch that answers like the relay for one team key, recording each request.
export interface Recorded { method: string, path: string, body: unknown, auth: string | null }

export const fakeRelay = (replies: Array<{ from: string, text: string }> = [], stale: Array<{ from: string, text: string }> = [], supersededAt = 0) => {
  const calls: Recorded[] = []
  let inboxCalls = 0
  const answer = (path: string, method: string): [number, unknown] => {
    if (path === '/v1/me') return [200, { kind: 'key', name: 'ci', team: 'acme', address: 'gh:ci@acme' }]
    if (method === 'PUT' && path === '/v1/sessions/ci') return [200, { address: 'gh:ci' }]
    if (method === 'POST' && path === '/v1/messages') return [201, { id: 'm1', online: true, to: 'cx:fixer@acme', delivery: 'prompt' }]
    if (path.startsWith('/v1/inbox/ci?')) {
      inboxCalls += 1
      if (supersededAt && inboxCalls >= supersededAt) return [403, { error: 'not_holder' }]
      const batch = inboxCalls === 1 ? stale.map((r, i) => ({ ...r, id: `s${i}` })) : inboxCalls === 2 ? replies.map((r, i) => ({ ...r, id: `r${i}` })) : []
      const messages = batch.map((m) => ({ ...m, hop: 1, sentAt: 0, delivery: 'prompt', fromPerson: 'bob@x.io' }))
      return [200, { messages }]
    }
    if (path === '/v1/inbox/ci/ack') return [204, null]
    if (path.startsWith('/text-error')) return [502, 'Bad gateway']
    return [404, { error: 'unknown' }]
  }
  const fetch = async (url: string | URL, init: RequestInit = {}): Promise<Response> => {
    const { pathname, search } = new URL(url)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    calls.push({ method, path: pathname + search, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get('authorization') })
    const [status, body] = answer(pathname + search, method)
    return new Response(body === null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}
