// The tools the model calls: send and who.

import type { ToolSpec } from 'claude-code'

export const SEND_TOOL: ToolSpec = {
  name: 'send',
  description: 'Send a message to another of the user\'s Claude Code sessions by its clawalkietalkie address, ' +
    'like cc:happy-dog. Use it whenever the user asks to pass, tell, send or report something to a cc: address. ' +
    'Write the text so the receiving session can act on it alone: it does not see this conversation.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'The address, like cc:happy-dog' },
      text: { type: 'string', description: 'The message, self-contained' }
    },
    required: ['to', 'text']
  },
  isDeferred: false
}

export const WHO_TOOL: ToolSpec = {
  name: 'who',
  description: 'List the user\'s Claude Code sessions on clawalkietalkie: their cc: addresses, ' +
    'whether each is online, and where it runs. This session is marked.',
  inputSchema: { type: 'object', properties: {} },
  isDeferred: false
}
