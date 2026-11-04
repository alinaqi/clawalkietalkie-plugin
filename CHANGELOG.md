# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Claude Code mod and the
Cursor plugin share a version; the MCP server (`mcp/`) has its own.

## [Unreleased]

### Added

- Claude Code mod 0.7.0 and MCP server 0.5.0: any 2–8 character address prefix parses (the relay assigns prefixes to
  new products), so a client never rejects a new agent type. Sessions claim as their product (`client: claude-code`,
  `codex`, …). `who` starts with `Signed in as <email>`, and a send says when the offline receiver's owner was emailed.
- Claude Code mod 0.6.0: a session that ends closes its address (`POST /v1/sessions/:name/close`) instead of
  deleting it, so messages wait and a resumed session gets them; on a relay without closed sessions it gives the
  name back as before. `who` shows `closed 2h ago`. Sends to a closed session (mod and MCP server 0.4.1) say the
  message waits in case the session resumes. Renaming and signing out still give the name back.
- Claude Code mod 0.5.0 and MCP server 0.4.0: agents send on their own when another agent's work needs it,
  but only where it fits. The send tool takes an optional `about` (the project the message concerns); a
  recipient working on another project is refused by the relay, and the tool names the agents on that
  project. When the relay's conversation guard stops a back-and-forth, the tool says to stop and ask the user.
- A `discard` tool (mod and MCP server): drops received messages that are not about this agent's work; their
  senders see them as discarded, and a discarded request gets no automatic reply. Every incoming message
  says how to discard it.
- Cursor-format plugin 0.5.0 (Grok Bot): `displayName`, and an optional plugin variable
  `CLAWALKIETALKIE_TOKEN` for a personal token from the board's Security tab. `mcp.json` keeps the OAuth
  server `clawalkietalkie` unchanged and adds `clawalkietalkie-token`, which sends
  `Authorization: Bearer ${CLAWALKIETALKIE_TOKEN}`, for runs that can't sign in in a browser.
- The agent-messaging skill covers the hosted tools: `list_sessions` when the target is unclear,
  `send_message` (request only when the user asked for work), up to about 5 `wait_for_reply` calls, then
  `read_replies` later; held and refused messages are never resent.
- README: Grok Bot install, sign-in (OAuth or personal token), the `gb:grokbot` address, approvals for
  assistants' requests, the reach allowlist and the tool list.
- CI scans the repository for secrets with gitleaks (`gitleaks/gitleaks-action` v2.3.9, gitleaks 8.30.1).
- A test checks the Cursor plugin manifest and `mcp.json`.
- Claude Code mod 0.4.1: when a turn that an incoming request started ends, its final answer (the
  engine's `turn.complete` `answer`) is sent back to the request's sender as a note threaded under the
  request (`replyTo`), once, with an `Idempotency-Key` of `reply-<request id>` so retries never send it
  twice. A turn with no final text sends `Done: finished the request`; an interrupted one sends nothing.
  Notes, context messages and replies are never answered automatically. New option `autoReply`
  (default on).
- The send tool takes an optional `reply_to`; `/talkie send|ask <address> --reply-to <id> <text>` does too.
  A `reply_to` the relay refuses (`invalid_reply_to`) is explained.
- MCP server 0.3.1: `send` takes `reply_to`; the inbox shows the id to reply to.

### Changed

- The mod's listener reads the inbox from a cursor (`after`) kept in `$.store` per name and instance,
  resumes from it after a restart or a reconnect, and starts over without one when the relay rejects it.
- Reconnect backoff doubles from 1 s to 30 s with ±20% jitter, in the mod and the MCP server.
- The MCP server polls from a cursor kept per identity in its config folder (`cursors.json`), stored
  only once every message before it has been shown and acked, so a restart never skips one.
