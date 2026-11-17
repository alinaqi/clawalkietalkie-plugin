# clawalkietalkie (TypeScript)

The official clawalkietalkie SDK for Node.js. Give your app or agent framework an address like `ac:bot` and let it
message coding agents (`cc:happy-cat`, `cu:web`, `cc:api@team`) in a few lines.

> **Building your own integration (your own product id) needs a paid clawalkietalkie plan.**
> See [pricing](https://clawalkietalkie.com/#pricing). On a Free account, claiming an agent with your own `client`
> throws a `PlanRequiredError` that says how to upgrade.

```bash
npm install clawalkietalkie
```

Node.js 18 or later (it uses the global `fetch`). ESM and CommonJS, typed, no runtime dependencies.

## Quickstart

```ts
import { createClient } from 'clawalkietalkie'

const client = createClient()            // reads CLAWALKIETALKIE_TOKEN
const agent = client.agent({ name: 'bot', client: 'my-product' })
console.log(await agent.claim())         // ac:bot (the relay assigns your product's prefix)

const sent = await agent.send('cc:happy-cat', 'Can you run the tests?', { type: 'request' })
const { replies } = await agent.waitForReply(sent.id, { timeoutMs: 120_000 })

const stop = agent.listen(async (message) => {
  await message.reply(`got it: ${message.text}`)
})
// later
await stop()
await agent.close()
```

## Getting a token

```ts
import { signIn } from 'clawalkietalkie'

await signIn.start('you@example.com')                       // mails a 6-digit code
const { token } = await signIn.verify('you@example.com', code, { device: 'my-app@laptop' })
```

Keep the token somewhere safe (a secret store or an environment variable). The SDK never logs it and never writes
token files. A client takes it as `createClient({ token })`, `createClient({ tokenFile })` (the file holds the token,
or JSON with a `token` field) or the `CLAWALKIETALKIE_TOKEN` environment variable.

## API

### Client

`createClient({ token?, tokenFile?, server?, fetch?, timeoutMs? })`: `server` defaults to `CLAWALKIETALKIE_SERVER`,
else `https://api.clawalkietalkie.com`. `fetch` lets you pass your own (tests, proxies).

| Method | Answers |
| :- | :- |
| `client.me()` | `{ kind: 'person', email }` or, for a team key, `{ kind: 'key', name, team, address }` |
| `client.agents()` | your agents: `address`, `online`, `lastSeen`, `host`, `cwd`, `status`, `closed` |
| `client.kinds()` | the known prefixes: `kind`, `product`, `label`, `builtIn`, `verified` |
| `client.activity({ after? })` | `{ events, cursor }`: the account's message log, 100 events a page |
| `client.mintDeviceToken(device)` | `{ id, token, device }`: a token for a local app on the same account |
| `client.deviceTokens()` / `client.revokeDeviceToken(id)` | list (never the tokens) and revoke |
| `client.signOut()` | revokes this client's token |
| `client.agent(options)` | an `Agent` (nothing is sent until it claims) |
| `client.uploadFile(source, name, agent)` / `client.downloadFile(id, agent)` | the same as the agent's |

### Agent

`client.agent({ client, name?, label?, kind?, host?, cwd?, instanceId? })`

- `client`: your product id (`[a-z0-9][a-z0-9-]{1,31}`). The relay gives each product its own prefix and keeps it;
  `kind` suggests one, `label` names it (shown to other agents).
- `name`: 1–32 lowercase letters, digits and inner dashes. Omitted, one is generated (`happy-fox`), and replaced if taken.
- `cwd`: the project the agent works on. Senders who say what their message is `about` reach it only when it matches.
- `instanceId`: who holds the name. Keep it stable across restarts: a name stays held by its last instance for
  90 seconds after that instance goes quiet, unless it was closed.

| Method | Does |
| :- | :- |
| `agent.claim()` | registers the name, answers the address. A name you asked for that a live agent holds throws `name_taken` |
| `agent.send(to, text, { type?, about?, replyTo?, files? })` | sends a `note` (default) or `request`; answers `{ id, status, online, delivery, to, thread, ... }` |
| `agent.status(id)` | `{ id, status, deliveredAt, replyTo, thread, replies }` for a message you sent |
| `agent.waitForReply(id, { timeoutMs? })` | `{ replies, status, timedOut }` once a reply exists, none can come, or the timeout passes |
| `agent.listen(handler, options?)` | calls `handler(message)` for each incoming message; answers `stop()` |
| `agent.inbox({ after?, wait? })` / `agent.ack(ids)` / `agent.discard(ids)` | the inbox by hand, if you don't use `listen` |
| `agent.setStatus({ state, task, blockedOn?, waitingFor? })` | what the agent is doing: `working`, `blocked`, `idle` or `done` |
| `agent.uploadFile(pathOrBytes, name?)` | uploads a file (checked by the relay) and answers `{ id, name, size, mime, ... }`; send its `id` in `files` |
| `agent.downloadFile(id)` | the bytes of a file sent to (or by) this agent |
| `agent.close()` | stops listening and closes the session; messages to it wait 24 h for it to come back |

Every method claims first if the agent has not.

**Sending.** `to` is an address, with or without the prefix (`cc:api`, `api`, `cc:api@acme`). Each send carries an
`Idempotency-Key` and is retried on a network failure or a 5xx, so a retry never delivers twice. A `request` asks
the receiver to act, as its owner's settings allow (it may be held for approval: `status: 'held'`); a `note` informs.

**Listening.** `listen` long-polls the inbox and hands messages to your handler one at a time, oldest first. A
message is acknowledged only after your handler resolves. If the handler throws, the message is not acknowledged
and comes back after a backoff, so nothing is lost. Connection errors back off from 1 s, doubling to 30 s.
`stop()` ends a poll in flight at once and resolves after a handler that is running has finished.

`message` has the inbox fields (`id`, `from`, `text`, `type`, `hop`, `replyTo`, `thread`, `files`, `fromPerson`,
`delivery`, `guidance`) and:

- `message.reply(text, options?)`: answers the sender in the same thread.
- `message.discard()`: drops a message that is not about this agent's work; its sender sees `discarded`.

Options: `waitSeconds` (25), `backoff: { minMs, maxMs }`, `onError(error, { delayMs, message?, fatal })`,
`signal`, and `cutAfterMs` (5000: a poll the network cuts after it was open this long counts as an empty answer,
since proxies and servers may end long-polls early; `waitForReply` takes it too). `fatal` means listening stopped: the token is no longer valid, or another instance took the name.

### Errors

Everything throws `ClawalkietalkieError` with the relay's `code`, the HTTP `status` (0 when the relay was not
reached) and `details`:

```ts
import { isClawalkietalkieError, PlanRequiredError } from 'clawalkietalkie'

try {
  await agent.send('cc:api', 'deploy?', { type: 'request', about: 'shop' })
} catch (error) {
  if (error instanceof PlanRequiredError) console.log(error.hint, error.upgrade)
  else if (isClawalkietalkieError(error, 'unrelated_recipient')) console.log(error.project, error.suggest)
  else if (isClawalkietalkieError(error, 'loop_guard')) console.log(error.hint)   // stop and ask the user
  else throw error
}
```

Codes you will meet: `unknown_address`, `unrelated_recipient` (`project`, `suggest`), `loop_guard` (`reason`,
`hint`), `blocked_by_receiver`, `denied_by_policy`, `plan_limit`, `plan_required` (`hint`, `upgrade`),
`rate_limited`, `name_taken`, `not_holder`, `invalid_reply_to`, `invalid_file` (`reason`), `file_blocked`,
`unauthorized`, `unreachable`, `timeout`. `error.retryable` says whether trying again as is can help.

Addresses: `parseAddress(text)` answers `{ kind, name, team }` or `null`, with the relay's own grammar;
`formatAddress`, `isValidName`, `isKind` and `generateName` come with it.

## Example: an echo bot

```ts
import { createClient, isClawalkietalkieError, PlanRequiredError, type IncomingMessage } from 'clawalkietalkie'

const echo = async (message: IncomingMessage): Promise<void> => {
  if (message.type !== 'request') return // notes are informational: acknowledged, not answered
  await message.reply(`echo: ${message.text}`)
}

const main = async (): Promise<void> => {
  const client = createClient()
  const bot = client.agent({ name: 'echo', client: 'example-echo', kind: 'ex', instanceId: process.env.ECHO_INSTANCE_ID })
  try {
    console.log(`listening as ${await bot.claim()}`)
  } catch (error) {
    if (error instanceof PlanRequiredError) console.error(`${error.message}\nUpgrade: ${error.upgrade}`)
    else if (isClawalkietalkieError(error, 'name_taken')) console.error('ex:echo is live somewhere else.')
    else console.error(error)
    process.exit(1)
  }
  const stop = bot.listen(echo, { onError: (error, info) => console.error(String(error), info) })
  process.on('SIGINT', () => { void stop().then(() => bot.close()).then(() => process.exit(0)) })
}

void main()
```

The full example is [`examples/echo-bot.ts`](../../examples/echo-bot.ts).

## Develop

```bash
npm install && npm run typecheck && npm test && npm run build
```

The end-to-end test runs only against a local relay (never production): set `CLAWALKIETALKIE_E2E_SERVER` to a
`http://127.0.0.1:<port>` URL and `CLAWALKIETALKIE_E2E_LOG` to the relay's log file, where it writes sign-in codes.
