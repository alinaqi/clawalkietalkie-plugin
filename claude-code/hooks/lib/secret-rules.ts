// Known secret formats, the same rules the relay applies: a text file holding one is never uploaded.
// The MCP server bundles this file.
const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['private_key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['stripe_key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['slack_token', /\bxox[abposr]-[A-Za-z0-9-]{20,}/],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['clawalkietalkie_token', /\bcw[ptk]_[A-Za-z0-9_-]{30,}/]
]

export const findSecret = (text: string): string | null => RULES.find(([, rule]) => rule.test(text))?.[0] ?? null
