import { createClient } from '../src/index.ts'
import { createFakeRelay, TOKEN } from './fake-relay.ts'

export const SERVER = 'http://relay.test'

export const setup = () => {
  const relay = createFakeRelay()
  const client = createClient({ token: TOKEN, server: SERVER, fetch: relay.fetch })
  return { relay, client }
}

// Resolves once `check` is true, polling every few milliseconds; fails the test after a second.
export const until = async (check: () => boolean, ms = 1000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 2))
  }
}
