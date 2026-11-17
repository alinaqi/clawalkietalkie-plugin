// An echo bot: claims ex:echo under the product id example-echo and answers every request with its text.
// Run: CLAWALKIETALKIE_TOKEN=... npx tsx echo-bot.ts   (npm install clawalkietalkie first)
// Building your own integration (your own product id) needs a paid clawalkietalkie plan: https://clawalkietalkie.com/#pricing
import { createClient, isClawalkietalkieError, PlanRequiredError, type Agent, type IncomingMessage } from 'clawalkietalkie'

const explain = (error: unknown): string => {
  if (error instanceof PlanRequiredError) return `${error.message}\nUpgrade: ${error.upgrade}`
  if (isClawalkietalkieError(error, 'name_taken')) return 'ex:echo is live somewhere else; stop it or pick another name.'
  return String(error)
}

const echo = async (message: IncomingMessage): Promise<void> => {
  if (message.type !== 'request') return // notes are informational: acked, not answered
  await message.reply(`echo: ${message.text}`)
  console.log(`answered ${message.from}`)
}

const serve = (bot: Agent): void => {
  const stop = bot.listen(echo, {
    onError: (error, info) => console.error(`listen: ${String(error)} (${info.fatal ? 'stopped' : `retrying in ${info.delayMs} ms`})`)
  })
  const shutdown = async (): Promise<void> => {
    await stop()
    await bot.close()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

const main = async (): Promise<void> => {
  const client = createClient()
  // A stable instanceId takes the name back at once after a restart (else the old instance holds it for 90 s).
  const bot = client.agent({ name: 'echo', client: 'example-echo', kind: 'ex', label: 'Example Echo', instanceId: process.env.ECHO_INSTANCE_ID })
  try {
    console.log(`listening as ${await bot.claim()}`)
  } catch (error) {
    console.error(explain(error))
    process.exit(1)
  }
  serve(bot)
}

void main()
