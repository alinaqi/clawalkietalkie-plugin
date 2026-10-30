// Shared by the mod's tests: the engine stand-ins and a fake relay.
import { mock, type Engine, type TestBody } from 'claude-code/testing'
import { createFakeRelay } from './fake-relay.ts'

export const SEND = 'mcp__clawalkietalkie__send'
export const WHO = 'mcp__clawalkietalkie__who'
type On = Parameters<TestBody>[1]

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

export const SIGNED_IN = { auth: { token: 'tok-1', email: 'a@x.io' }, 'session:sess-1': { name: 'happy-dog', instanceId: 'inst-dog' } }

export const setup = (on: On, store: Record<string, unknown> = {}) => {
  const relay = createFakeRelay()
  const seen = { prompts: [] as string[], statuses: [] as Array<string | undefined>, toasts: [] as string[], tools: [] as string[], commands: [] as string[] }
  const clock = mock.clock(on)
  mock.store(on, store)
  on('session.start', () => ({ cwd: '/work/web' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('http.fetch', ($, e) => ({ value: relay.fetch(e.url, e.init) }))
  on('command.register', ($, e) => { seen.commands.push(e.name); return { value: { command: e.name } } })
  on('tool.register', ($, e) => { seen.tools.push(e.name); return { value: { tool: `mcp__clawalkietalkie__${e.name}` } } })
  on('prompt.submit', ($, e) => { seen.prompts.push(e.text); return { text: e.text } })
  on('ui.status', ($, e) => { seen.statuses.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { seen.toasts.push(e.text); return { value: undefined } })
  return { relay, seen, clock }
}

export const start = ($: Engine) => $.session.start({ cwd: '/work/web', surface: 'terminal', isInteractive: true })
export const talkie = async ($: Engine, args: string) => (await $.command.run({ command: 'talkie', args, ...TYPED })).text ?? ''
