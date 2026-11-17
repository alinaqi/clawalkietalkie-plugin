// The address grammar, [<kind>:]<name>[@<team>], as the relay speaks it (the same as claude-code/hooks/lib/address.ts).

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
const KIND = /^[a-z][a-z0-9]{1,7}$/

const ADJECTIVES = [
  'happy', 'brave', 'calm', 'eager', 'fuzzy', 'gentle', 'jolly', 'lucky',
  'mellow', 'nimble', 'quiet', 'rapid', 'sunny', 'swift', 'witty', 'zesty'
]

const ANIMALS = [
  'cat', 'dog', 'fox', 'owl', 'otter', 'panda', 'koala', 'lynx',
  'moose', 'heron', 'gecko', 'bison', 'crane', 'llama', 'mole', 'yak'
]

// kind and team are null when the address does not give them.
export interface Address { kind: string | null, name: string, team: string | null }

export const isKind = (value: string): boolean => KIND.test(value)

export const isValidName = (name: string): boolean => NAME.test(name)

// Accepts "cx:Review-Bot", " review-bot " or "cc:api@acme"; null for anything the relay would refuse.
export const parseAddress = (input: string): Address | null => {
  const [local = '', team = null, ...rest] = input.trim().toLowerCase().split('@')
  if (rest.length > 0 || (team !== null && !isValidName(team))) return null
  const match = /^([^:]*):(.*)$/.exec(local)
  if (match && !isKind(match[1]!)) return null
  const name = match ? match[2]! : local
  return isValidName(name) ? { kind: match ? match[1]! : null, name, team } : null
}

// An address as it goes to the relay: a missing kind stays missing, so the relay resolves it.
export const formatAddress = (address: Address): string => {
  const local = address.kind ? `${address.kind}:${address.name}` : address.name
  return address.team ? `${local}@${address.team}` : local
}

// An adjective-animal name; `random` returns a float in [0, 1), like Math.random.
export const generateName = (random: () => number): string => {
  const pick = (list: readonly string[]): string => list[Math.floor(random() * list.length)] ?? list[0]!
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
}
