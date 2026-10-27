import type { EngineInterface, Register } from 'claude-code'

import {
  FOCUS_DOC, FOCUS_LIMIT, compactInstructions, decide, levelsFor, nudgeText, resumeText, squash, toolDescription,
} from './ladder'

const NAME = 'compact_me'
const TOOL = 'mcp__smart-compact__compact_me'

const focus = { plugin: 'smart-compact', key: 'focus' } as const
const resuming = { plugin: 'smart-compact', key: 'resuming' } as const

export const register: Register = (on, options) => {
  const before = String(options.beforeCompact ?? '').trim()
  const note = String(options.summaryNote ?? '').trim()
  const startAt = Math.max(0, Number(options.startAt ?? 0) || 0) * 1000
  const main: Main = { nudged: 0, queued: false, startAt, before }

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: NAME,
      description: toolDescription(before),
      inputSchema: {
        type: 'object',
        properties: { focus: { type: 'string', description: FOCUS_DOC } },
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
    main.queued = true
    return { result: 'Queued: the conversation is compacted once this turn ends, and the task continues after it. End the turn now, with one line saying what follows.' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${NAME}: failed, nothing queued.` }))

  on('prompt.submit', async ($, e, next) => {
    const nudge = await mainNudge($, main)
    return next(nudge === null ? e : { ...e, context: [...(e.context ?? []), nudge] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // Subagents auto-compact on their own, so only the main session is nudged.
    if (e.tool === TOOL || ran.deny !== undefined || e.agentId !== undefined) return ran
    const nudge = await mainNudge($, main)
    return nudge === null ? ran : { ...ran, context: [...(ran.context ?? []), nudge] }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    main.queued = false
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

type Main = { nudged: number; queued: boolean; readonly startAt: number; readonly before: string }

/** The main session's nudge when its context passed a new step, else null; none while a compaction is queued. */
async function mainNudge($: EngineInterface, main: Main): Promise<string | null> {
  if (main.queued) return null
  const { tokens = 0, window } = (await $.session.usage()).context
  const levels = levelsFor(window, main.startAt)
  const [due, remember] = decide(tokens, main.nudged, levels)
  main.nudged = remember
  return due === null ? null : nudgeText(tokens, levels, main.before, TOOL)
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
