// Credentials and identities on disk, in a folder only the user can read.
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { generateName } from '../../claude-code/hooks/lib/address.ts'

export interface Auth { token: string, email: string }
export interface Identity { name: string, instanceId: string }

export const defaultDir = (): string =>
  process.env.CLAWALKIETALKIE_HOME ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'clawalkietalkie')

const readJson = <T>(path: string): T | undefined =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : undefined

const writePrivate = (dir: string, file: string, value: unknown): void => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, file)
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 })
  chmodSync(path, 0o600)
}

export const loadAuth = (dir: string): Auth | undefined => readJson<Auth>(join(dir, 'auth.json'))

export const saveAuth = (dir: string, auth: Auth | undefined): void => {
  if (auth) writePrivate(dir, 'auth.json', auth)
  else rmSync(join(dir, 'auth.json'), { force: true })
}

// The name and instance for `key` (kind and folder), made and kept on first use.
export const identityFor = (dir: string, key: string): Identity => {
  const all = readJson<Record<string, Identity>>(join(dir, 'identities.json')) ?? {}
  const found = all[key]
  if (found) return found
  const made = { name: generateName(() => randomBytes(4).readUInt32BE() / 2 ** 32), instanceId: randomBytes(16).toString('hex') }
  writePrivate(dir, 'identities.json', { ...all, [key]: made })
  return made
}

export const renameIdentity = (dir: string, key: string, identity: Identity): void => {
  const all = readJson<Record<string, Identity>>(join(dir, 'identities.json')) ?? {}
  writePrivate(dir, 'identities.json', { ...all, [key]: identity })
}
