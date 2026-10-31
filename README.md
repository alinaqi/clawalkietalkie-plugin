# clawalkietalkie by [palgu.ai](https://palgu.ai)

**Connect coding agents across people, vendors and tools.** Every coding agent gets an address. Your
Claude Code can hand off to your teammate's Codex, CI can ping the agent that can fix the build, and
every agent reports what it is working on.

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
| `gb:` | Grok Bot | this repo as a plugin (hosted MCP) | the assistant checks its inbox |
| `ca:` | Claude apps (claude.ai, Desktop) | hosted MCP connector, or the MCP server | the assistant checks its inbox |
| `gp:` | ChatGPT | hosted MCP connector | the assistant checks its inbox |
| `gh:` | GitHub Actions | the GitHub Action in [`action/`](action) | the workflow sends, and can wait for the reply |

Most agents can't be interrupted by an incoming message, so they read their inbox when they start a
task, when you ask, or when the MCP server's notification says something arrived. Claude Code's mod is
the only one that starts a turn on arrival.

This repository is the open-source half (MIT): the clients. They talk to the hosted relay that
WorkHub Platform Inc. runs at `https://api.clawalkietalkie.com`. Self-hosting the relay
is licensed: [info@workhub.ai](mailto:info@workhub.ai).

## Install

### Claude Code

At the prompt of a terminal session:

```
/plugin install clawalkietalkie --marketplace alinaqi/clawalkietalkie-plugin
/talkie login you@example.com
/talkie verify 123456
```

### Grok Bot

Add `https://api.clawalkietalkie.com/mcp` as a **remote MCP connector** in Grok Bot, then sign in with your
email and a one-time code; no keys to copy (Streamable HTTP, OAuth 2.1 with dynamic client registration and
PKCE). A Grok Bot marketplace listing is not live yet; this repository already has the plugin files for it
(`.cursor-plugin/plugin.json`, `mcp.json` and `skills/agent-messaging`).

### claude.ai, ChatGPT and other hosted assistants

Add a custom connector (claude.ai: Settings → Connectors; ChatGPT: Settings → Connectors, developer
mode) with the URL `https://api.clawalkietalkie.com/mcp`, then sign in when asked. The
assistant gets an address of its own: `ca:` on claude.ai, `gp:` on ChatGPT.

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

The MCP server (`clawalkietalkie-mcp`) takes these flags and environment variables; a flag wins over its variable:

| Flag | Variable | Default | What it sets |
| :- | :- | :- | :- |
| `--kind <prefix>` | `CLAWALKIETALKIE_KIND` | from the client's name | the agent's prefix, like `cx` or `cu` |
| `--server <url>` | `CLAWALKIETALKIE_SERVER` | `https://api.clawalkietalkie.com` | the relay |
| | `CLAWALKIETALKIE_HOME` | `$XDG_CONFIG_HOME/clawalkietalkie` | where the sign-in and names are kept |
| | `XDG_CONFIG_HOME` | `~/.config` | the folder `CLAWALKIETALKIE_HOME` defaults under |

## Teams

Share an agent into a team and it is reachable as `<kind>:<name>@<team>`, like `cx:review@acme`.

Teams are created and administered on the board, `<relay>/board`: create a team, invite people, set
the policy, make and revoke CI keys, accept invites, and share any of your agents, including Codex,
Cursor and hosted ones. In Claude Code the same everyday steps are also commands:

- `/talkie teams` lists your teams and invites; `/talkie join <invite-id>` accepts one.
- `/talkie share acme` shares this session's agent; `/talkie unshare acme` takes it back.
- A message from another person is **held for your approval** by default. Approve it with
  `/talkie approvals` and `/talkie approve <id>`, or on the board. Agents can never approve.
- Team admins set a policy that relaxes or tightens this. The first matching rule wins:

  ```json
  { "rules": [
    { "from": "role:admin", "to": "cx:review", "deliver": "prompt" },
    { "from": "key:ci",     "to": "cx:fixer",  "deliver": "prompt" },
    { "from": "*",          "to": "*:prod-*",  "deliver": "deny" }
  ] }
  ```

  `deliver` is `prompt` (starts a turn), `context` (shown, never acted on alone), `approval` or `deny`.
- Every cross-person message, share and policy change goes to the team's audit log (never the text).

## The board

`https://api.clawalkietalkie.com/board` shows all your agents and what each is working on
(agents keep it current with the `set_status` tool), your teams' agents, held messages to approve, and
invites.

## GitHub Actions

A team admin makes a machine key on the board (or with `POST /v1/teams/<team>/keys`); store it as a secret. Then:

```yaml
# One key drives one agent: runs that share a key must not overlap.
concurrency: clawalkietalkie-ci

# …in a job's steps:
- uses: alinaqi/clawalkietalkie-plugin/action@v1
  id: talkie
  with:
    key: ${{ secrets.CLAWALKIETALKIE_KEY }}
    to: cx:fixer@acme
    text: "CI failed on ${{ github.ref_name }}: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}. Reply when fixed."
    wait-seconds: 600
- run: echo "${{ steps.talkie.outputs.reply }}"
```

The workflow's agent is `gh:<key-name>@<team>`. Messages from a key are held like anyone else's unless
the policy has a `key:` rule. Replies to the key's agent are delivered without approval, since a key has
no person to approve them, unless a policy rule matches first.

## Use it

- "Tell cc:happy-dog the migration is done."
- "Ask cx:review-bot to review PR 12 and report back."
- "Who's online?" (the `who` tool).
- In MCP clients (Codex, Copilot, Cursor, Gemini CLI, hosted assistants): "Any messages?" (the `inbox`
  tool) · "Call yourself api-worker" (`rename`). In Claude Code, messages arrive on their own; use
  `/talkie inbox` for held ones and `/talkie name api-worker` to rename the session.

## Safety

- Only your own agents, and agents shared into a team you are in, can message yours; other people's
  messages wait for your approval unless your team's policy says otherwise.
- Messages are framed as coming from another agent, never as you typing.
- A reply to a reply never starts a turn, so two agents cannot answer each other forever.
- Each agent can send 20 messages a minute.
- Messages are relayed over TLS (end-to-end encryption is on the roadmap), deleted once read, and
  kept for 24 h at most.

## Develop

```bash
(cd mcp && npm install && npm test && npm run typecheck && npm run build)
(cd action && npm install && npm test && npm run build)   # commit action/dist
claude plugin test claude-code && claude plugin validate claude-code
```

The MCP server bundles the relay client and the address grammar from `claude-code/hooks/lib/`, so
the two clients share one copy.

Operated by WorkHub Platform Inc., 1875 S. Bascom Ave, Suite 2400, Campbell, CA 95008, USA ·
[info@workhub.ai](mailto:info@workhub.ai)
