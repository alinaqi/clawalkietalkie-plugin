// Entry point for the GitHub Action.
import { main } from './main.ts'

process.exitCode = await main({ env: process.env, fetch: globalThis.fetch, now: Date.now, log: (line) => console.log(line) })
