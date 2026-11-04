import { expect, test } from 'claude-code/testing'
import { formatWho } from '../hooks/lib/who.ts'
import { SEND, SIGNED_IN, setup, start } from './harness.ts'

test('who shows a closed session as closed, with when it ended', () => {
  const text = formatWho([{ address: 'cc:fuzzy-mole', online: false, closed: true, lastSeen: 0, host: 'win', cwd: 'srooter' }], { self: 'happy-dog', now: 2 * 3600_000 })
  expect(text).toMatch(/○ cc:fuzzy-mole · win:srooter · closed 2h ago/)
})

test('a send to a closed session says it waits in case the session resumes', async ($, on) => {
  const { relay } = setup(on, SIGNED_IN)
  relay.override('POST /v1/messages', { status: 201, body: { id: 'm9', online: false, closed: true, to: 'cc:fuzzy-mole', delivery: 'prompt', type: 'note', status: 'queued', thread: 'm9' } })
  await start($)
  const res = await $.tool.call({ tool: SEND, to: 'cc:fuzzy-mole', text: 'merged' })
  expect(res.result).toMatch(/cc:fuzzy-mole has closed \(its session ended\); it gets this if it resumes within 24 h/)
})
