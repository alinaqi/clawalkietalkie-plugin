// Files on the relay: an upload's body is the file itself (text, or base64 for binaries, since the mod's HTTP carries
// text), and a download answers the content as text (base64 for binaries).
import type { Fetch, RelayConfig, Result } from './relay-core.ts'

export interface Uploaded { id: string, name: string, size: number, mime: string, status: string }
export interface FileHolder { from: string, instanceId: string }

const auth = (config: RelayConfig): Record<string, string> => config.token ? { authorization: `Bearer ${config.token}` } : {}

const refusal = (status: number, text: string): Result<never> => {
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  const { error, ...details } = json
  return { ok: false, status, error: String(error ?? 'error'), ...(Object.keys(details).length > 0 ? { details } : {}) }
}

export const fileCalls = (fetch: Fetch, config: RelayConfig) => {
  const base = config.baseUrl.replace(/\/+$/, '')
  return {
    upload: async (who: FileHolder, file: { name: string, body: string, base64: boolean }): Promise<Result<Uploaded>> => {
      const query = new URLSearchParams({ from: who.from, instanceId: who.instanceId, name: file.name })
      const headers = { ...auth(config), 'content-type': 'application/octet-stream', ...(file.base64 ? { 'x-content-encoding': 'base64' } : {}) }
      const res = await fetch(`${base}/v1/files?${query}`, { method: 'POST', headers, body: file.body }).catch(() => null)
      if (!res) return { ok: false, status: 0, error: 'unreachable' }
      return res.ok ? { ok: true, value: JSON.parse(res.text) as Uploaded } : refusal(res.status, res.text)
    },
    content: async (id: string, who: { as: string, instanceId: string }, base64: boolean): Promise<Result<string>> => {
      const query = new URLSearchParams({ as: who.as, instanceId: who.instanceId, ...(base64 ? { encoding: 'base64' } : {}) })
      const res = await fetch(`${base}/v1/files/${encodeURIComponent(id)}/content?${query}`, { headers: auth(config) }).catch(() => null)
      if (!res) return { ok: false, status: 0, error: 'unreachable' }
      return res.ok ? { ok: true, value: res.text } : refusal(res.status, res.text)
    }
  }
}
