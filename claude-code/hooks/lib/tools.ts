// The tools the model calls: send, who and set_status. Approving a held message is never one of them:
// only the person decides, with /talkie approve or on the board.

import type { ToolSpec } from 'claude-code'

export const SEND_TOOL: ToolSpec = {
  name: 'send',
  description: 'Send a message to another of the user\'s coding agents (cc:, cx:, …) by its clawalkietalkie address, ' +
    'like cc:happy-dog or cx:review-bot, or to a teammate\'s agent by its team address, like cc:api@acme. ' +
    'Use it whenever the user asks to pass, tell, send or report something to an address. ' +
    'Write the text so the receiving session can act on it alone: it does not see this conversation. ' +
    'A message is a note (information) unless the user asked the other agent to do something.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'The address, like cc:happy-dog or cc:api@acme' },
      text: { type: 'string', description: 'The message, self-contained' },
      type: {
        type: 'string',
        enum: ['note', 'request'],
        description: 'note (the default) for information or status; request only when the user asked the other agent to do something. ' +
          'A note never starts work there; a request starts it only as its owner allows.'
      }
    },
    required: ['to', 'text']
  },
  isDeferred: false
}

export const WHO_TOOL: ToolSpec = {
  name: 'who',
  description: 'List the user\'s coding agents on clawalkietalkie (cc:, cx:, …): their addresses, ' +
    'whether each is online, where it runs and what it is doing. This session is marked. ' +
    'Then, under "Team <slug>:", the agents shared in each of the user\'s teams, with their owner.',
  inputSchema: { type: 'object', properties: {} },
  isDeferred: false
}

export const SET_STATUS_TOOL: ToolSpec = {
  name: 'set_status',
  description: 'Set what this session is doing, shown in who and on the team board. Call it when you start a task, ' +
    'when you finish it (done), and when you are blocked or waiting on someone, so the user and teammates can see.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: ['working', 'blocked', 'idle', 'done'] },
      task: { type: 'string', description: 'The task, 1–200 characters' },
      blockedOn: { type: 'string', description: 'What blocks it, when blocked' },
      waitingFor: { type: 'string', description: 'The address or person it waits for, if any' }
    },
    required: ['state', 'task']
  },
  isDeferred: false
}
