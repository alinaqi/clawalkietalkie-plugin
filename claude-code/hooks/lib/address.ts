// The address grammar, <kind>:<name>, as the relay speaks it. The MCP server bundles this file too.

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

const ADJECTIVES = [
  'happy', 'brave', 'calm', 'eager', 'fuzzy', 'gentle', 'jolly', 'lucky',
  'mellow', 'nimble', 'quiet', 'rapid', 'sunny', 'swift', 'witty', 'zesty'
]

const ANIMALS = [
  'cat', 'dog', 'fox', 'owl', 'otter', 'panda', 'koala', 'lynx',
  'moose', 'heron', 'gecko', 'bison', 'crane', 'llama', 'mole', 'yak'
]

// The prefix names the agent behind an address.
export const KINDS = {
  cc: 'Claude Code',
  cx: 'Codex',
  cp: 'Copilot',
  gb: 'Grok Bot',
  cu: 'Cursor',
  gm: 'Gemini CLI',
  gh: 'GitHub Actions',
  ca: 'Claude apps',
  gp: 'ChatGPT'
} as const

export type Kind = keyof typeof KINDS

export const isKind = (value: string): value is Kind => Object.hasOwn(KINDS, value)

export const isValidName = (name: string): boolean => NAME.test(name)

export interface Target { kind: Kind | null, name: string }

// Accepts "cx:Review-Bot", "review-bot" or " review-bot "; kind is null when no prefix is given.
export const parseTarget = (input: string): Target | null => {
  const trimmed = input.trim().toLowerCase()
  const match = /^([a-z]{2}):(.*)$/.exec(trimmed)
  if (match && !isKind(match[1]!)) return null
  const kind = match ? match[1] as Kind : null
  const name = match ? match[2]! : trimmed
  return isValidName(name) ? { kind, name } : null
}

// The name alone, whatever the prefix; null when not an address.
export const parseAddress = (input: string): string | null => parseTarget(input)?.name ?? null

export const formatAddress = (name: string, kind: Kind = 'cc'): string => `${kind}:${name}`

// `random` returns a float in [0, 1), like Math.random.
export const generateName = (random: () => number): string => {
  const pick = (list: readonly string[]) => list[Math.floor(random() * list.length)] ?? list[0]
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
}

const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost)
    }
    previous = row
  }
  return previous[b.length]!
}

// The registered name a mistyped one most likely meant, or null. Dashes are ignored,
// and short names need a closer match so "ab" never suggests "cd".
export const suggestName = (typed: string, names: readonly string[]): string | null => {
  const bare = (name: string) => name.replaceAll('-', '')
  const limit = Math.min(2, Math.floor(bare(typed).length / 3))
  const scored = names.map((name) => ({ name, score: distance(bare(typed), bare(name)) }))
  const best = scored.filter((s) => s.score <= limit).sort((a, b) => a.score - b.score)[0]
  return best?.name ?? null
}
