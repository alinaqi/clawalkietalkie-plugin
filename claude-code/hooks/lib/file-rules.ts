// What a client may send from disk, before any upload: images and text only, nothing hidden (dotfiles, .git, .env),
// no key or credentials files. The relay checks again; these refusals keep secrets from leaving the machine at all.
// The MCP server bundles this file.
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
export const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'log', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'c', 'h', 'cpp', 'cs', 'swift', 'sql', 'sh', 'toml', 'ini', 'css', 'scss', 'diff', 'patch'])
const KEY_FILE = /(\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$|^id_(rsa|dsa|ecdsa|ed25519)|credentials|^secrets?\.)/i
// The most a client reads to send (the mod's file reads are capped at 4 MiB).
export const MAX_SEND_BYTES = 4 * 1024 * 1024

export type PathProblem = 'outside' | 'hidden' | 'secret_file' | 'type_not_allowed'

export const extOf = (name: string): string => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''

// A path relative to the project root, checked by its parts.
export const pathProblem = (relative: string): PathProblem | null => {
  const parts = relative.split(/[\\/]/).filter(Boolean)
  const name = parts.at(-1) ?? ''
  if (parts.length === 0 || parts.includes('..')) return 'outside'
  if (parts.some((part) => part.startsWith('.'))) return 'hidden'
  if (KEY_FILE.test(name)) return 'secret_file'
  return IMAGE_EXTS.has(extOf(name)) || TEXT_EXTS.has(extOf(name)) ? null : 'type_not_allowed'
}

export const PROBLEM_TEXT: Record<PathProblem | 'too_large' | 'ignored' | 'missing', string> = {
  outside: 'it is outside this project',
  hidden: 'it is hidden (a dotfile, or inside .git or another dot folder)',
  secret_file: 'it looks like a key or credentials file',
  type_not_allowed: 'only images (png, jpeg, gif, webp) and text files can be sent',
  too_large: 'it is larger than 4 MB',
  ignored: 'it is ignored by git (build output, dependencies or local secrets)',
  missing: 'not found'
}
