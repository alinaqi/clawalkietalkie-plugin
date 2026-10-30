import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

// Writes step outputs to $GITHUB_OUTPUT in the delimited form, so any value (multi-line too) is safe.
export const writeOutputs = (file: string, outputs: Record<string, string | undefined>): void => {
  for (const [name, value] of Object.entries(outputs)) {
    if (value === undefined) continue
    const delimiter = `cwt_${randomUUID()}`
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
  }
}
