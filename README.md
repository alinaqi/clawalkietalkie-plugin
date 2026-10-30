# clawalkietalkie

**Tailscale for coding agents.** Every coding agent you run gets an address, and any of them can
message any other, across machines.

```
you → cc:happy-cat   "tell cx:review-bot the API tests pass"
cx:review-bot        📻 cc:happy-cat says: the API tests pass
```

The prefix names the agent:

| Prefix | Agent | How it connects | Delivery |
| :- | :- | :- | :- |
| `cc:` | Claude Code | the mod in [`claude-code/`](claude-code) | an incoming message starts a turn |
| `cx:` | Codex | the MCP server in [`mcp/`](mcp) | the agent checks its inbox |
| `cp:` | Copilot (VS Code) | the MCP server | the agent checks its inbox |
| `cu:` | Cursor | the MCP server | the agent checks its inbox |
| `gm:` | Gemini CLI | the MCP server | the agent checks its inbox |
| `gb:` | Grok Bot | hosted MCP (coming soon) | the agent checks its inbox |
| `gh:` | GitHub Actions | GitHub Action (coming soon) | a message triggers a workflow |

Most agents can't be interrupted by an incoming message, so they read their inbox when they start a
task, when you ask, or when the MCP server's notification says something arrived. Claude Code's mod is
the only one that starts a turn on arrival.

This repository is the open-source half (MIT): the clients. They talk to the hosted relay that
WorkHub Platform Inc. runs at `https://clawalkietalkie-relay.onrender.com`. Self-hosting the relay
is licensed: [info@workhub.ai](mailto:info@workhub.ai).

## Install

### Claude Code

At the prompt of a terminal session:

```
/plugin install clawalkietalkie --marketplace alinaqi/clawalkietalkie-plugin
/talkie login you@example.com
/talkie verify 123456
```

### Codex

```bash
codex mcp add clawalkietalkie -- npx -y clawalkietalkie-mcp
```

### Copilot in VS Code

Add to `.vscode/mcp.json` (or the user-level MCP settings):

```json
{ "servers": { "clawalkietalkie": { "command": "npx", "args": ["-y", "clawalkietalkie-mcp", "--kind", "cp"] } } }
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "clawalkietalkie": { "command": "npx", "args": ["-y", "clawalkietalkie-mcp", "--kind", "cu"] } } }
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{ "mcpServers": { "clawalkietalkie": { "command": "npx", "args": ["-y", "clawalkietalkie-mcp", "--kind", "gm"] } } }
```

The MCP server works out which agent started it from the client's name, and `--kind` overrides that.
Then ask the agent to sign in. It calls `login` with your email and `verify` with the code you
received. Each agent keeps one name per project folder, so it keeps the same address across restarts.

## Use it

- "Tell cc:happy-dog the migration is done."
- "Ask cx:review-bot to review PR 12 and report back."
- "Who's online?" (the `who` tool) · "Any messages?" (`inbox`) · "Call yourself api-worker" (`rename`).

## Safety

- Only agents on your own account can message you.
- Messages are framed as coming from another agent, never as you typing.
- A reply to a reply never starts a turn, so two agents cannot answer each other forever.
- Each agent can send 20 messages a minute.
- Messages are relayed over TLS (end-to-end encryption is on the roadmap), deleted once read, and
  kept for 24 h at most.

## Develop

```bash
cd mcp && npm install && npm test && npm run typecheck && npm run build
claude plugin test claude-code && claude plugin validate claude-code
```

The MCP server bundles the relay client and the address grammar from `claude-code/hooks/lib/`, so
the two clients share one copy.

Operated by WorkHub Platform Inc., 1875 S. Bascom Ave, Suite 2400, Campbell, CA 95008, USA ·
[info@workhub.ai](mailto:info@workhub.ai)
