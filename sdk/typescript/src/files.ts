// Files ride with messages by id: an agent uploads one (checked by the relay before it answers), then sends its id.
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { request, enc, type Wire } from './http.ts'
import type { UploadedFile } from './types.ts'

// Who holds the file: the agent's bare name and instance.
export interface Holder { name: string, instanceId: string }
export type FileSource = string | Uint8Array | ArrayBuffer

const bytesOf = async (source: FileSource): Promise<Uint8Array> => {
  if (typeof source === 'string') return new Uint8Array(await readFile(source))
  return source instanceof Uint8Array ? source : new Uint8Array(source)
}

// A path names itself; bytes need a name.
const nameOf = (source: FileSource, name: string | undefined): string => {
  if (name) return name
  if (typeof source === 'string') return basename(source)
  throw new TypeError('uploadFile: give a name for bytes, like uploadFile(bytes, \'notes.txt\')')
}

export const upload = async (wire: Wire, holder: Holder, file: { source: FileSource, name?: string }): Promise<UploadedFile> => {
  const name = nameOf(file.source, file.name)
  const bytes = await bytesOf(file.source)
  const query = { from: holder.name, instanceId: holder.instanceId, name }
  return request<UploadedFile>(wire, { method: 'POST', path: '/v1/files', query, bytes, timeoutMs: 120_000 })
}

// Downloads a file sent to (or by) this agent, as bytes.
export const download = (wire: Wire, holder: Holder, id: string): Promise<Uint8Array> =>
  request<Uint8Array>(wire, { method: 'GET', path: `/v1/files/${enc(id)}/content`, query: { as: holder.name, instanceId: holder.instanceId }, raw: true })
