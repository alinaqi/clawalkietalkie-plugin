# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The Claude Code mod and the
Cursor plugin share a version; the MCP server (`mcp/`) has its own.

## [Unreleased]

### Added

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
