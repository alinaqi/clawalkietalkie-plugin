// Files that came with messages are saved outside every project, under ~/.clawalkietalkie/inbox/<message id>/, as
// <name>.received: never over an existing file, never run or unpacked. Text is written directly; a binary arrives as
// base64 and is decoded by the shell (PowerShell on Windows), since the mod writes text only.
import type { EngineInterface } from 'claude-code'
import type { InboxFile, InboxMessage, SavedFile } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

const isText = (mime: string): boolean => mime.startsWith('text/') || mime.startsWith('application/json')

const POSIX_WRITE = 'mkdir -p "$(dirname "$1")" && base64 -d > "$1"'
const POWERSHELL_WRITE = '$p = $env:CWT_OUT; New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; ' +
  '[IO.File]::WriteAllBytes($p, [Convert]::FromBase64String([Console]::In.ReadToEnd()))'

async function writeBinary ($: EngineInterface, path: string, base64: string): Promise<boolean> {
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = windows ? ['powershell', '-NoProfile', '-Command', POWERSHELL_WRITE] : ['sh', '-c', POSIX_WRITE, 'sh', path]
  const res = await $.process.run(argv, { stdin: base64, ...(windows ? { env: { CWT_OUT: path } } : {}) }).catch(() => undefined)
  return res?.exitCode === 0
}

async function saveOne ($: EngineInterface, t: Talkie, file: InboxFile, dir: string): Promise<SavedFile> {
  const path = `${dir}/${file.name}.received`
  const saved = { name: file.name, mime: file.mime, size: file.size }
  if (await $.fs.exists(path)) return { ...saved, path }
  const text = isText(file.mime)
  const res = await relayOf($, t).files.content(file.id, { as: t.identity.name, instanceId: t.identity.instanceId }, !text)
  if (!res.ok) return { ...saved, error: `could not be downloaded (${res.error})` }
  if (text) await $.fs.write(path, res.value)
  else if (!await writeBinary($, path, res.value)) return { ...saved, error: 'could not be written to disk' }
  return { ...saved, path }
}

async function homeOf ($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined))
}

// The messages, each with where its files were saved (or why one was not).
export async function saveFiles ($: EngineInterface, t: Talkie, messages: readonly InboxMessage[]): Promise<InboxMessage[]> {
  if (!messages.some((m) => m.files?.length)) return [...messages]
  const home = await homeOf($)
  const out: InboxMessage[] = []
  for (const message of messages) {
    if (!message.files?.length || !home) { out.push(message); continue }
    const dir = `${home}/.clawalkietalkie/inbox/${message.id}`
    const saved: SavedFile[] = []
    for (const file of message.files) saved.push(await saveOne($, t, file, dir).catch(() => ({ name: file.name, mime: file.mime, size: file.size, error: 'could not be saved' })))
    out.push({ ...message, saved })
  }
  return out
}
