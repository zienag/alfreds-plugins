import type { EngineInterface, Register } from 'claude-code'

import {
  FOCUS_LIMIT, compactInstructions, contextTokens, decide, handoverText, levelsFor, nudgeText, resumeText, squash, windowFor,
} from './ladder'

const NAME = 'compact_me'
const TOOL = 'mcp__smart-compact__compact_me'

const focus = { plugin: 'smart-compact', key: 'focus' } as const
const resuming = { plugin: 'smart-compact', key: 'resuming' } as const

export const register: Register = (on, options) => {
  const before = String(options.beforeCompact ?? '').trim()
  const note = String(options.summaryNote ?? '').trim()
  const startAt = Math.max(0, Number(options.startAt ?? 0) || 0) * 1000
  let nudged = 0
  let queued = false
  let mainModel = ''
  const agents = new Map<string, { model: string; tokens: number; nudged: number }>()

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
      isDeferred: false,
    })
    const started = await next(e)
    await resume($)
    return started
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: `${NAME}: only the main session compacts.` }
    const text = squash(typeof e.focus === 'string' ? e.focus : '')
    if (text === '') return { deny: `${NAME}: focus is empty. Name the task the work continues with. Nothing queued.` }
    if (text.length > FOCUS_LIMIT) {
      return { deny: `${NAME}: focus is ${text.length} characters, limit ${FOCUS_LIMIT}. Shorten it. Nothing queued.` }
    }
    await $.state.set(focus, text)
    queued = true
    return { result: 'Queued: the conversation is compacted once this turn ends, and the task continues after it. End the turn now.' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: failed, nothing queued.` }))

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (e.agentId === undefined) mainModel = e.model
    else if (step.usage !== null) {
      const agent = agents.get(e.agentId)
      agents.set(e.agentId, { model: e.model, tokens: contextTokens(step.usage), nudged: agent?.nudged ?? 0 })
    }
    return step
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === TOOL || ran.deny !== undefined) return ran
    const agent = e.agentId
    if (agent === undefined && queued) return ran
    const { tokens: mainTokens = 0, window: mainWindow } = (await $.session.usage()).context
    const main = { model: mainModel, window: mainWindow }
    if (agent === undefined) {
      const levels = levelsFor(mainWindow, startAt)
      const [due, remember] = decide(mainTokens, nudged, levels)
      const first = nudged === 0
      nudged = remember
      if (due === null) return ran
      return { ...ran, context: [...(ran.context ?? []), nudgeText(mainTokens, first, levels, before, TOOL)] }
    }
    const who = agents.get(agent)
    if (who === undefined) return ran
    const levels = levelsFor(windowFor(who.model, main), startAt)
    const [due, remember] = decide(who.tokens, who.nudged, levels)
    who.nudged = remember
    if (due === null) return ran
    return { ...ran, context: [...(ran.context ?? []), handoverText(who.tokens, levels)] }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      agents.delete(e.agentId)
      return done
    }
    queued = false
    const { value: planned = null } = await $.state.get(focus)
    if (planned === null) return done
    await $.state.set(focus, null)
    if (e.reason !== 'answer') {
      $.ui.toast('smart-compact: the turn was interrupted, the queued compaction dropped')
      return done
    }
    await $.state.set(resuming, resumeText())
    $.clock.after(0, () => void compact($, compactInstructions(planned, before, note)))
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
