// Files on the MCP server: sending reads only files inside the project (real paths), never hidden, key, ignored or
// secret-bearing ones; received files are saved under ~/.clawalkietalkie/inbox/<message>/<name>.received, never over
// an existing file and never run. Both go as base64, like the Claude Code mod.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { extOf, IMAGE_EXTS, MAX_SEND_BYTES, PROBLEM_TEXT, pathProblem } from '../../claude-code/hooks/lib/file-rules.ts'
import type { InboxMessage, SavedFile } from '../../claude-code/hooks/lib/relay.ts'
import { findSecret } from '../../claude-code/hooks/lib/secret-rules.ts'
import { relayOf, type AgentState } from './state.ts'

type Located = { real: string } | { error: string }

const realOf = (path: string): string | null => { try { return realpathSync(path) } catch { return null } }

const isIgnored = (root: string, real: string): boolean => spawnSync('git', ['check-ignore', '-q', real], { cwd: root }).status === 0

const locate = (root: string, path: string): Located => {
  if (path.split(/[\\/]/).includes('..')) return { error: PROBLEM_TEXT.outside }
  const real = realOf(isAbsolute(path) ? path : join(root, path))
  if (!real) return { error: PROBLEM_TEXT.missing }
  if (!real.startsWith(root + sep)) return { error: PROBLEM_TEXT.outside }
  const problem = pathProblem(relative(root, real))
  if (problem) return { error: PROBLEM_TEXT[problem] }
  if (statSync(real).size > MAX_SEND_BYTES) return { error: PROBLEM_TEXT.too_large }
  return isIgnored(root, real) ? { error: PROBLEM_TEXT.ignored } : { real }
}

const prepare = (root: string, path: string): { name: string, body: string, base64: boolean } | { error: string } => {
  const found = locate(root, path)
  if ('error' in found) return found
  const name = found.real.split(sep).at(-1)!
  if (IMAGE_EXTS.has(extOf(name))) return { name, body: readFileSync(found.real).toString('base64'), base64: true }
  const text = readFileSync(found.real, 'utf8')
  const secret = findSecret(text)
  return secret ? { error: `it looks like a secret (${secret})` } : { name, body: text, base64: false }
}

export const uploadPaths = async (s: AgentState, paths: readonly string[]): Promise<{ ids: string[] } | { error: string }> => {
  const root = realOf(s.deps.cwd) ?? s.deps.cwd
  const prepared = paths.map((path) => ({ path, file: prepare(root, path) }))
  const refused = prepared.find((p) => 'error' in p.file)
  if (refused && 'error' in refused.file) return { error: `Not sent: ${refused.path}: ${refused.file.error}.` }
  const ids: string[] = []
  for (const { path, file } of prepared) {
    if ('error' in file) continue
    const res = await relayOf(s).files.upload({ from: s.identity.name, instanceId: s.identity.instanceId }, file)
    if (!res.ok) return { error: `Not sent: ${path} was refused by the relay (${String(res.details?.reason ?? res.error)}).` }
    ids.push(res.value.id)
  }
  return { ids }
}

const saveOne = async (s: AgentState, file: NonNullable<InboxMessage['files']>[number], dir: string): Promise<SavedFile> => {
  const path = join(dir, `${file.name}.received`)
  const saved = { name: file.name, mime: file.mime, size: file.size }
  const res = await relayOf(s).files.content(file.id, { as: s.identity.name, instanceId: s.identity.instanceId }, true)
  if (!res.ok) return { ...saved, error: `could not be downloaded (${res.error})` }
  mkdirSync(dir, { recursive: true })
  try { writeFileSync(path, Buffer.from(res.value, 'base64'), { flag: 'wx', mode: 0o600 }) } catch { /* already saved */ }
  return { ...saved, path }
}

export const saveReceived = async (s: AgentState, messages: readonly InboxMessage[]): Promise<InboxMessage[]> => {
  const out: InboxMessage[] = []
  for (const message of messages) {
    if (!message.files?.length) { out.push(message); continue }
    const dir = join(s.deps.home, '.clawalkietalkie', 'inbox', message.id)
    const saved: SavedFile[] = []
    for (const file of message.files) saved.push(await saveOne(s, file, dir).catch(() => ({ name: file.name, mime: file.mime, size: file.size, error: 'could not be saved' })))
    out.push({ ...message, saved })
  }
  return out
}
