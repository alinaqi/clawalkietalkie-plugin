// src/main.ts
import { randomUUID as randomUUID3 } from "crypto";

// src/inputs.ts
var DEFAULT_SERVER = "https://api.clawalkietalkie.com";
var MAX_WAIT_SECONDS = 3600;
var required = (env, name) => {
  const value = env[`INPUT_${name.toUpperCase()}`]?.trim();
  if (!value) throw new Error(`The ${name} input is required.`);
  return value;
};
var readInputs = (env) => {
  const key = required(env, "key");
  if (!key.startsWith("cwk_")) throw new Error("The key input must be a team key (cwk_\u2026), made by a team admin.");
  const wait = Number(env.INPUT_WAIT_SECONDS ?? 0);
  return {
    key,
    to: required(env, "to"),
    text: required(env, "text"),
    server: env.INPUT_SERVER?.trim() || DEFAULT_SERVER,
    waitSeconds: Number.isFinite(wait) ? Math.min(Math.max(0, Math.floor(wait)), MAX_WAIT_SECONDS) : 0
  };
};

// src/outputs.ts
import { randomUUID } from "crypto";
import { appendFileSync } from "fs";
var writeOutputs = (file, outputs) => {
  for (const [name, value] of Object.entries(outputs)) {
    if (value === void 0) continue;
    const delimiter = `cwt_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delimiter}
${value}
${delimiter}
`);
  }
};

// src/run.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/relay.ts
var parseBody = (text) => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text.slice(0, 200) };
  }
};
var relayClient = (server, key, fetch) => {
  const call = async (method, path, body) => {
    const res = await fetch(`${server.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...body === void 0 ? {} : { "content-type": "application/json" } },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const json = parseBody(await res.text());
    if (!res.ok) throw new Error(`The relay answered ${res.status}: ${String(json.error ?? "error")}`);
    return json;
  };
  return {
    me: () => call("GET", "/v1/me"),
    claim: (name, instanceId) => call("PUT", `/v1/sessions/${name}`, { instanceId, kind: "gh", host: "github-actions" }),
    send: (input) => call("POST", "/v1/messages", { ...input, hop: 0 }),
    inbox: (name, instanceId, wait) => call("GET", `/v1/inbox/${name}?instanceId=${instanceId}&wait=${wait}`),
    ack: (name, instanceId, ids) => call("POST", `/v1/inbox/${name}/ack`, { instanceId, ids })
  };
};

// src/run.ts
var POLL_SECONDS = 25;
var waitForReply = async (w, now) => {
  while (now() < w.deadline) {
    const wait = Math.max(1, Math.min(POLL_SECONDS, Math.ceil((w.deadline - now()) / 1e3)));
    const { messages } = await w.relay.inbox(w.name, w.instanceId, wait);
    if (messages.length === 0) continue;
    await w.relay.ack(w.name, w.instanceId, messages.map((m) => m.id));
    const reply = messages.find((m) => m.from === w.from);
    if (reply) return reply.text;
  }
  return void 0;
};
var drain = async (relay, name, instanceId) => {
  const { messages } = await relay.inbox(name, instanceId, 0);
  if (messages.length > 0) await relay.ack(name, instanceId, messages.map((m) => m.id));
};
var superseded = (error) => {
  if (error instanceof Error && error.message.includes("not_holder")) {
    throw new Error("A newer run with the same key took over its agent. Runs that share a key must not overlap: put them in one concurrency group.");
  }
  throw error;
};
var run = async ({ inputs, fetch, now }) => {
  const relay = relayClient(inputs.server, inputs.key, fetch);
  const me = await relay.me();
  const instanceId = randomUUID2();
  await relay.claim(me.name, instanceId);
  await drain(relay, me.name, instanceId);
  const sent = await relay.send({ from: me.name, instanceId, to: inputs.to, text: inputs.text });
  const outputs = { id: sent.id, to: sent.to, delivery: sent.delivery, from: me.address };
  if (inputs.waitSeconds <= 0) return outputs;
  const deadline = now() + inputs.waitSeconds * 1e3;
  const reply = await waitForReply({ relay, name: me.name, instanceId, from: sent.to, deadline }, now).catch(superseded);
  return reply === void 0 ? outputs : { ...outputs, reply };
};

// src/main.ts
var printReply = (log, from, reply) => {
  const token = `cwt-${randomUUID3()}`;
  log(`::stop-commands::${token}`);
  log(`Reply from ${from}:`);
  for (const line of reply.split("\n")) log(line);
  log(`::${token}::`);
};
var main = async ({ env, fetch, now, log }) => {
  try {
    const inputs = readInputs(env);
    log(`::add-mask::${inputs.key}`);
    const outputs = await run({ inputs, fetch, now });
    log(`Sent to ${outputs.to} as ${outputs.from} (${outputs.delivery}).`);
    if (outputs.reply !== void 0) printReply(log, outputs.to, outputs.reply);
    if (env.GITHUB_OUTPUT) writeOutputs(env.GITHUB_OUTPUT, { ...outputs });
    return 0;
  } catch (error) {
    log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

// src/index.ts
process.exitCode = await main({ env: process.env, fetch: globalThis.fetch, now: Date.now, log: (line) => console.log(line) });
