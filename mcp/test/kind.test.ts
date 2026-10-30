import { describe, expect, it } from 'vitest'
import { detectKind } from '../src/kind.ts'

describe('detectKind', () => {
  it('reads the agent from the MCP client name', () => {
    expect(detectKind('codex-mcp-client')).toBe('cx')
    expect(detectKind('claude-code')).toBe('cc')
    expect(detectKind('claude-ai')).toBe('ca')
    expect(detectKind('Claude Desktop')).toBe('ca')
    expect(detectKind('cursor-vscode')).toBe('cu')
    expect(detectKind('Visual Studio Code')).toBe('cp')
    expect(detectKind('github-copilot')).toBe('cp')
    expect(detectKind('gemini-cli-mcp-client')).toBe('gm')
    expect(detectKind('grok-bot')).toBe('gb')
  })

  it('lets --kind win over the client name', () => {
    expect(detectKind('codex-mcp-client', 'gh')).toBe('gh')
  })

  it('falls back to cx for a client it does not know', () => {
    expect(detectKind(undefined)).toBe('cx')
    expect(detectKind('some-new-agent')).toBe('cx')
  })
})
