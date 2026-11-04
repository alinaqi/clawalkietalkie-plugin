// Sending files from this session's project: each path must land inside the project (symbolic links resolved), not be
// hidden, a key file, ignored by git, or hold a secret. Only then is it read and uploaded; the ids go with the message.
import type { EngineInterface } from 'claude-code'
import { extOf, IMAGE_EXTS, MAX_SEND_BYTES, PROBLEM_TEXT, pathProblem } from './file-rules.ts'
import { findSecret } from './secret-rules.ts'
import { relayOf, type Talkie } from './talkie.ts'

type Prepared = { name: string, body: string, base64: boolean } | { error: string }

const inside = (root: string, real: string): boolean => real.startsWith(`${root}/`) || real.startsWith(`${root}\\`)
const absolute = (root: string, path: string): string => /^([a-zA-Z]:)?[\\/]/.test(path) ? path : `${root}/${path}`

async function isIgnored ($: EngineInterface, root: string, real: string): Promise<boolean> {
  const res = await $.process.run(['git', 'check-ignore', '-q', real], { cwd: root }).catch(() => undefined)
  return res?.exitCode === 0
}

async function locate ($: EngineInterface, t: Talkie, path: string): Promise<{ real: string, size: number } | { error: string }> {
  if (path.split(/[\\/]/).includes('..')) return { error: PROBLEM_TEXT.outside }
  const root = (await $.fs.stat(t.root, { resolve: true }).catch(() => undefined))?.realPath ?? t.root
  const stat = await $.fs.stat(absolute(t.root, path), { resolve: true }).catch(() => undefined)
  if (!stat?.realPath) return { error: PROBLEM_TEXT.missing }
  if (!inside(root, stat.realPath)) return { error: PROBLEM_TEXT.outside }
  const problem = pathProblem(stat.realPath.slice(root.length + 1))
  if (problem) return { error: PROBLEM_TEXT[problem] }
  if (stat.size > MAX_SEND_BYTES) return { error: PROBLEM_TEXT.too_large }
  return await isIgnored($, root, stat.realPath) ? { error: PROBLEM_TEXT.ignored } : { real: stat.realPath, size: stat.size }
}

async function prepare ($: EngineInterface, t: Talkie, path: string): Promise<Prepared> {
  const found = await locate($, t, path)
  if ('error' in found) return found
  const name = found.real.split(/[\\/]/).at(-1)!
  if (IMAGE_EXTS.has(extOf(name))) return { name, body: (await $.fs.read(found.real, { as: 'bytes' })).base64, base64: true }
  const text = await $.fs.read(found.real)
  const secret = findSecret(text)
  return secret ? { error: `it looks like a secret (${secret})` } : { name, body: text, base64: false }
}

// The uploaded ids, or why one file could not go (nothing is sent then).
export async function uploadFiles ($: EngineInterface, t: Talkie, paths: readonly string[]): Promise<{ ids: string[] } | { error: string }> {
  const prepared: Array<{ path: string, file: Prepared }> = []
  for (const path of paths) prepared.push({ path, file: await prepare($, t, path) })
  const refused = prepared.find((p) => 'error' in p.file)
  if (refused && 'error' in refused.file) return { error: `Not sent: ${refused.path}: ${refused.file.error}.` }
  const ids: string[] = []
  for (const { path, file } of prepared) {
    if ('error' in file) continue
    const res = await relayOf($, t).files.upload({ from: t.identity.name, instanceId: t.identity.instanceId }, file)
    if (!res.ok) return { error: `Not sent: ${path} was refused by the relay (${String(res.details?.reason ?? res.error)}).` }
    ids.push(res.value.id)
  }
  return { ids }
}
