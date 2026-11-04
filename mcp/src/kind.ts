import { isKind, type Kind } from '../../claude-code/hooks/lib/address.ts'

// Matched against the name the MCP client sends at initialize; first match wins, so Cursor
// (whose client name mentions vscode) is tried before Copilot.
const CLIENTS: ReadonlyArray<[RegExp, Kind]> = [
  [/codex/i, 'cx'],
  [/claude[- ]?code/i, 'cc'],
  [/claude/i, 'ca'],
  [/cursor/i, 'cu'],
  [/gemini/i, 'gm'],
  [/grok/i, 'gb'],
  [/copilot|visual studio code|vscode/i, 'cp']
]

export const detectKind = (clientName: string | undefined, override?: string): Kind => {
  if (override && isKind(override)) return override
  return CLIENTS.find(([pattern]) => pattern.test(clientName ?? ''))?.[1] ?? 'cx'
}

const PRODUCTS: Readonly<Record<string, string>> = {
  cc: 'claude-code', cx: 'codex', cp: 'copilot', gb: 'grok-bot', cu: 'cursor', gm: 'gemini-cli', ca: 'claude-apps', gp: 'chatgpt'
}

// The product id the relay knows a built-in prefix by; undefined for any other prefix (sent as kind alone).
export const productOf = (kind: Kind): string | undefined => PRODUCTS[kind]
