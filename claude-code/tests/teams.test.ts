import { expect, test } from 'claude-code/testing'
import { SEND, SET_STATUS, SIGNED_IN, WHO, setup, start, talkie, typed } from './harness.ts'

const ACME = { slug: 'acme', name: 'Acme', role: 'member', members: [], agents: [{ address: 'cc:api@acme', owner: 'bob@acme.io', online: true, status: null }] }

test('sends to a team address, keeping the team', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect((await $.tool.call({ tool: SEND, to: 'cc:api@acme', text: 'rebase' })).result).toMatch(/Sent to cc:api@acme/)
  expect(await talkie($, 'send api@acme hi')).toMatch(/Sent to cc:api@acme/)
  expect(relay.find('POST', '/v1/messages').map((c) => c.body?.to)).toEqual(['cc:api@acme', 'api@acme'])
})

test('a held message says it waits for its owner', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm1', online: true, to: 'cc:api@acme', delivery: 'held' } })
  expect((await $.tool.call({ tool: SEND, to: 'cc:api@acme', text: 'x' })).result).toMatch(/held until its owner approves it/)
})

test('not_shared and denied_by_policy are explained', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 403, body: { error: 'not_shared' } })
  expect(await talkie($, 'send cc:api@acme x')).toMatch(/not shared in acme.*\/talkie share acme/)
  relay.override('POST /v1/messages', { status: 403, body: { error: 'denied_by_policy' } })
  expect(await talkie($, 'send cc:api@acme x')).toMatch(/policy/)
})

test('an unknown team address gets no did-you-mean', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/messages', { status: 404, body: { error: 'unknown_address' } })
  const text = await talkie($, 'send cc:happy-cta@acme x')
  expect(text).toMatch(/No agent is called cc:happy-cta@acme/)
  expect(text).not.toMatch(/Did you mean/)
})

test('/talkie teams lists teams, invites and the board', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('GET /v1/teams', { status: 200, body: { teams: [{ slug: 'acme', name: 'Acme', role: 'admin' }] } })
  relay.override('GET /v1/invites', { status: 200, body: { invites: [{ id: 'inv-1', team: 'beta', name: 'Beta', role: 'member', invitedBy: 'eve@beta.io' }] } })
  const text = await talkie($, 'teams')
  expect(text).toMatch(/acme \(Acme\) · admin/)
  expect(text).toMatch(/inv-1 · Beta \(beta\) · member · from eve@beta\.io/)
  expect(text).toContain('https://clawalkietalkie-relay.onrender.com/board')
})

test('/talkie join accepts an invite', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('POST /v1/invites/inv-1/accept', { status: 200, body: { slug: 'beta', name: 'Beta', role: 'member' } })
  expect(await talkie($, 'join inv-1')).toMatch(/Joined Beta \(beta\) as member/)
  expect(await talkie($, 'join')).toMatch(/Usage/)
})

test('/talkie share and unshare put this session in a team and take it out', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('PUT /v1/teams/acme/agents/happy-dog', { status: 200, body: { address: 'cc:happy-dog@acme' } })
  expect(await talkie($, 'share acme')).toMatch(/shared in acme as cc:happy-dog@acme/)
  expect(relay.find('PUT', '/v1/teams/acme/agents/happy-dog')[0]?.body).toEqual({})
  expect(await talkie($, 'unshare acme')).toMatch(/no longer shared in acme/)
  expect(relay.find('DELETE', '/v1/teams/acme/agents/happy-dog')).toHaveLength(1)
  relay.override('PUT /v1/teams/acme/agents/happy-dog', { status: 409, body: { error: 'name_taken' } })
  expect(await talkie($, 'share acme')).toMatch(/\/talkie name/)
})

test('/talkie approvals lists held messages; approve and deny decide them', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  expect(await talkie($, 'approvals')).toMatch(/No messages/)
  const held = { id: 'ap-1', from: 'cc:api@acme', fromEmail: 'bob@acme.io', to: 'cc:happy-dog', text: 'drop the db', sentAt: 0 }
  relay.override('GET /v1/approvals', { status: 200, body: { approvals: [held] } })
  expect(await talkie($, 'approvals')).toMatch(/ap-1 · from cc:api@acme \(bob@acme\.io\)[\s\S]*drop the db/)
  expect(await talkie($, 'approve ap-1')).toMatch(/Allowed/)
  expect(await talkie($, 'deny ap-1')).toMatch(/Denied/)
  expect(relay.find('POST', '/v1/approvals/ap-1').map((c) => c.body)).toEqual([{ decision: 'allow' }, { decision: 'deny' }])
})

test('no tool the model can call approves or denies a message', async ($, on) => {
  const { seen } = setup(on, SIGNED_IN)
  await start($)
  expect(seen.tools.filter((name) => /approv|deny|decide|allow/.test(name))).toEqual([])
})

test('set_status sets this agent\'s status, and refuses a bad one', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  const res = await $.tool.call({ tool: SET_STATUS, state: 'blocked', task: 'deploy', blockedOn: 'CI' })
  expect(res.result).toMatch(/Status set: blocked: deploy/)
  expect(relay.find('PUT', '/v1/sessions/happy-dog/status')[0]?.body).toEqual({ instanceId: 'inst-dog', state: 'blocked', task: 'deploy', blockedOn: 'CI' })
  expect((await $.tool.call({ tool: SET_STATUS, state: 'napping', task: 'x' })).result).toMatch(/state is one of/)
  expect((await $.tool.call({ tool: SET_STATUS, state: 'idle', task: '' })).result).toMatch(/1–200/)
})

test('who shows team agents under their team', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  await start($)
  relay.override('GET /v1/teams', { status: 200, body: { teams: [{ slug: 'acme', name: 'Acme', role: 'member' }] } })
  relay.override('GET /v1/teams/acme', { status: 200, body: ACME })
  expect((await $.tool.call({ tool: WHO })).result).toMatch(/Team acme:\n● cc:api@acme · bob@acme\.io/)
  expect(await talkie($, 'who')).toMatch(/Team acme:/)
})

test('a context message starts no turn and rides along with the next prompt', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:api@acme', 'fyi: deployed', 0, { delivery: 'context', fromPerson: 'bob@acme.io' })
  await start($)
  await clock.advance(1000)
  expect(seen.prompts).toHaveLength(0)
  expect(seen.toasts.at(-1)).toMatch(/fyi: deployed/)
  await typed($, 'what next?')
  expect(seen.contexts.at(-1)?.[0]).toMatch(/fyi: deployed[\s\S]*for context only/)
  await typed($, 'and then?')
  expect(seen.contexts.at(-1)).toEqual([])
})

test('a teammate\'s prompt message is framed as theirs and answered at the next hop', async ($, on) => {
  const { relay, seen, clock } = setup(on, SIGNED_IN)
  relay.deliver('cc:api@acme', 'rebase please', 0, { delivery: 'prompt', fromPerson: 'bob@acme.io' })
  await start($)
  await clock.advance(1000)
  expect(seen.prompts[0]).toContain('teammate bob@acme.io')
  await $.tool.call({ tool: SEND, to: 'cc:api@acme', text: 'done' })
  expect(relay.find('POST', '/v1/messages')[0]?.body).toMatchObject({ to: 'cc:api@acme', hop: 1 })
})
