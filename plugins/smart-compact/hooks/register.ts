import type { EngineInterface, Register } from 'claude-code'

import { FOCUS_LIMIT, compactInstructions, decide, levelsFor, nudgeText, resumeText, squash } from './ladder'

const NAME = 'compact_me'
const TOOL = 'mcp__smart-compact__compact_me'

const nudged = { plugin: 'smart-compact', key: 'nudged' } as const
const focus = { plugin: 'smart-compact', key: 'focus' } as const
const resuming = { plugin: 'smart-compact', key: 'resuming' } as const

export const register: Register = (on, options) => {
  const before = String(options.beforeCompact ?? '').trim()
  const note = String(options.summaryNote ?? '').trim()

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: NAME,
      description:
        'Compact this conversation once the current turn ends, then carry on with the task. ' +
        'Call it as the last action of a turn, then end the turn. ' +
        `focus: a tweet-size instruction (up to ${FOCUS_LIMIT} characters) for the compactor ` +
        'naming the task the work continues with and the finished ones; never a summary.',
      inputSchema: {
        type: 'object',
        properties: { focus: { type: 'string', description: 'What the summary should keep in detail' } },
        required: ['focus'],
      },
    })
    const started = await next(e)
    await resume($)
    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: `${NAME}: only the main session compacts.` }
    const text = squash(e.focus)
    if (text.length > FOCUS_LIMIT) {
      return { deny: `${NAME}: focus is ${text.length} characters, limit ${FOCUS_LIMIT}. Shorten it. Nothing queued.` }
    }
    await $.state.set(focus, text)
    return { result: 'Queued: the conversation is compacted once this turn ends, and the task continues after it. End the turn now.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || e.tool === TOOL || ran.deny !== undefined) return ran
    const { tokens = 0, window } = (await $.session.usage()).context
    const levels = levelsFor(window)
    const { value: was = 0 } = await $.state.get(nudged)
    const [due, remember] = decide(tokens, was, levels)
    if (remember !== was) await $.state.set(nudged, remember)
    if (due === null) return ran
    return { ...ran, context: [...(ran.context ?? []), nudgeText(tokens, was === 0, levels, before, TOOL)] }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const { value: queued = null } = await $.state.get(focus)
    if (queued === null) return done
    await $.state.set(focus, null)
    if (e.reason !== 'answer') {
      $.ui.toast('smart-compact: the turn was interrupted, the queued /compact dropped')
      return done
    }
    await $.state.set(resuming, resumeText())
    $.clock.after(0, () => void compact($, compactInstructions(queued, before, note)))
    return done
  })
}

async function compact($: EngineInterface, instructions: string): Promise<void> {
  try {
    await $.command.run({ command: 'compact', args: instructions })
  } catch (error) {
    await $.state.set(resuming, null)
    $.ui.toast(`smart-compact: /compact failed: ${String(error)}`)
    return
  }
  await resume($)
}

/** Submits the planned continue prompt once; a reload of the mod during /compact submits it from session.start. */
async function resume($: EngineInterface): Promise<void> {
  const { value: planned = null } = await $.state.get(resuming)
  if (planned === null) return
  await $.state.set(resuming, null)
  await $.prompt.submit({ text: planned })
}
