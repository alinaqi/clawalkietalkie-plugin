// Where the token comes from: given, a token file (read, never written), or CLAWALKIETALKIE_TOKEN.
import { readFileSync } from 'node:fs'
import { ClawalkietalkieError } from './errors.ts'

export interface TokenSource { token?: string, tokenFile?: string }

// A token file holds the token alone, or JSON with a `token` field (like the MCP server's auth.json).
const fromFile = (path: string): string => {
  const text = readFileSync(path, 'utf8').trim()
  if (!text.startsWith('{')) return text
  const token = (JSON.parse(text) as { token?: unknown }).token
  return typeof token === 'string' ? token : ''
}

const env = (name: string): string | undefined => {
  const value = typeof process === 'undefined' ? undefined : process.env[name]
  return value ? value : undefined
}

export const resolveToken = (source: TokenSource): string => {
  const token = source.token ?? (source.tokenFile ? fromFile(source.tokenFile) : env('CLAWALKIETALKIE_TOKEN'))
  if (token) return token
  throw new ClawalkietalkieError(0, 'no_token')
}

export const resolveServer = (server: string | undefined): string => server ?? env('CLAWALKIETALKIE_SERVER') ?? 'https://api.clawalkietalkie.com'
