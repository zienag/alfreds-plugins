import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const RESUME = 'Continue the task. If the turn before ended with a question to the user, wait for the answer instead.'

test('a queued focus compacts after the answer, then the task continues', async ($, on) => {
  const { calls, clock } = world(on, { tokens: 100_000 })
  await queue($, 'focus on the auth bug fix; the deploy is finished')
  expect(calls).toEqual([])
  await $.turn.complete(answered())
  await clock.settle()
  expect(calls).toEqual([
    'compact: focus on the auth bug fix; the deploy is finished Omit the compaction routine itself: context nudges, compact_me.',
    `submit: Context compacted. ${RESUME}`,
  ])
})

test('the configured step and note reach the nudge and the compactor', {
  options: { beforeCompact: 'run the debrief skill', summaryNote: 'Write the summary in English.' },
}, async ($, on) => {
  const { calls, clock } = world(on, { tokens: 255_000 })
  const [nudge] = await nudges($)
  expect(nudge).toContain('Between tasks or subtasks, run the debrief skill, then call the tool')
  await queue($, 'focus on the parser')
  await $.turn.complete(answered())
  await clock.settle()
  expect(calls[0]).toEqual(
    'compact: focus on the parser Omit the compaction routine itself: context nudges, the step before compacting, compact_me. ' +
    'Write the summary in English.',
  )
})

test('a reload of the mod while /compact runs still continues the task, once', async ($, on) => {
  const held = world(on, { tokens: 100_000 })
  held.isCompactHeld = true
  await queue($, 'focus on the parser')
  await $.turn.complete(answered())
  await held.clock.settle()
  expect(held.calls).toHaveLength(1)
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })
  expect(held.calls[1]).toEqual(`submit: Context compacted. ${RESUME}`)
  held.release()
  await held.clock.settle()
  expect(held.calls).toHaveLength(2)
})

test('an interrupted turn drops the queued compaction', async ($, on) => {
  const { calls, clock } = world(on, { tokens: 100_000 })
  await queue($, 'focus on the parser')
  await $.turn.complete({ ...answered(), reason: 'aborted', isAborted: true })
  await clock.advance(10_000)
  await $.turn.complete(answered())
  await clock.advance(10_000)
  expect(calls).toEqual([])
})

test('a focus over the limit is refused and nothing is queued', async ($, on) => {
  const { calls, clock } = world(on, { tokens: 100_000 })
  const ran = await $.tool.call({ tool: COMPACT_ME, focus: 'x'.repeat(281) } as never)
  expect(ran.deny).toContain('limit 280')
  await $.turn.complete(answered())
  await clock.advance(10_000)
  expect(calls).toEqual([])
})

test('an empty focus is refused', async ($, on) => {
  world(on, { tokens: 100_000 })
  const ran = await $.tool.call({ tool: COMPACT_ME, focus: ' \n ' } as never)
  expect(ran.deny).toContain('focus is empty')
})

test('a subagent cannot queue a compaction of the main session', async ($, on) => {
  world(on, { tokens: 100_000 })
  const ran = await $.tool.call({ tool: COMPACT_ME, focus: 'mine', agentId: 'a1' } as never)
  expect(ran.deny).toContain('only the main session compacts')
})

test('the nudge comes once per ladder step, explains the focus only the first time, and re-arms after the size fell', async ($, on) => {
  const usage = world(on, { tokens: 240_000 })
  expect(await nudges($)).toEqual([])
  usage.tokens = 255_000
  const [first] = await nudges($)
  expect(first).toContain('Context 255k > 250k. Between tasks or subtasks, call the tool')
  expect(first).toContain('A summary or a retelling')
  usage.tokens = 270_000
  expect(await nudges($)).toEqual([])
  usage.tokens = 310_000
  const [second] = await nudges($)
  expect(second).toContain('Context 310k > 300k. Strongly advised')
  expect(second).not.toContain('A summary or a retelling')
  usage.tokens = 40_000
  expect(await nudges($)).toEqual([])
  usage.tokens = 251_000
  expect((await nudges($))[0]).toContain('A summary or a retelling')
})

test('parallel tool calls past a step are nudged once between them', async ($, on) => {
  world(on, { tokens: 255_000 })
  const ran = await Promise.all([
    $.tool.call({ tool: 'Bash', command: 'ls' } as never),
    $.tool.call({ tool: 'Read', file_path: '/x' } as never),
  ])
  expect(ran.flatMap(r => [...(r.context ?? [])])).toHaveLength(1)
})

test('once a focus is queued the nudges stop until the turn ends', async ($, on) => {
  const usage = world(on, { tokens: 255_000 })
  await queue($, 'focus on the parser')
  usage.tokens = 310_000
  expect(await nudges($)).toEqual([])
  await $.turn.complete({ ...answered(), reason: 'aborted', isAborted: true })
  expect(await nudges($)).toHaveLength(1)
})

test('a 200k window is nudged from 60% of it, before the built-in auto-compact', async ($, on) => {
  const usage = world(on, { tokens: 110_000, window: 200_000 })
  expect(await nudges($)).toEqual([])
  usage.tokens = 121_000
  expect((await nudges($))[0]).toContain('Context 121k > 120k. Between tasks')
  usage.tokens = 161_000
  expect((await nudges($))[0]).toContain('Context 161k > 160k. Compact immediately')
})

test('startAt moves the whole ladder in proportion, past the 200k window cap', {
  options: { startAt: 150 },
}, async ($, on) => {
  const usage = world(on, { tokens: 140_000, window: 200_000 })
  expect(await nudges($)).toEqual([])
  usage.tokens = 151_000
  expect((await nudges($))[0]).toContain('Context 151k > 150k. Between tasks')
  usage.tokens = 181_000
  expect((await nudges($))[0]).toContain('Context 181k > 180k. Strongly advised')
})

test("a subagent is asked to hand over on its own context's ladder, once per step, never to compact", async ($, on) => {
  const usage = world(on, { tokens: 420_000 })
  await step($, usage, 'a1', 100_000)
  expect(await nudges($, 'a1')).toEqual([])
  await step($, usage, 'a1', 255_000)
  await step($, usage, 'a2', 50_000)
  const [calm] = await nudges($, 'a1')
  expect(calm).toContain('Context 255k: a lot, not a limit. Two thirds of your task done? Carry on.')
  expect(calm).toContain('write a hand-over for a fresh agent')
  expect(calm).not.toContain(COMPACT_ME)
  expect(await nudges($, 'a1')).toEqual([])
  expect(await nudges($, 'a2')).toEqual([])
  await step($, usage, 'a1', 401_000)
  expect((await nudges($, 'a1'))[0]).toContain('Context 401k. Stop now: write a hand-over')
  usage.tokens = 100_000
  expect(await nudges($)).toEqual([])
})

test("a subagent on a smaller model is measured against that model's window", async ($, on) => {
  const usage = world(on, { tokens: 100_000 })
  await step($, usage, 'a1', 119_000, 'claude-haiku-4-5-20251001')
  expect(await nudges($, 'a1')).toEqual([])
  await step($, usage, 'a1', 121_000, 'claude-haiku-4-5-20251001')
  expect((await nudges($, 'a1'))[0]).toContain('Context 121k: a lot, not a limit.')
  await step($, usage, 'a1', 161_000, 'claude-haiku-4-5-20251001')
  expect((await nudges($, 'a1'))[0]).toContain('Context 161k. Stop now')
})

test('a [1m] tag on the request names a million, whatever the catalogue says of the model', async ($, on) => {
  const usage = world(on, { tokens: 100_000, window: 200_000 })
  await step($, usage, 'a1', 255_000, 'claude-sonnet-4-6[1m]')
  expect((await nudges($, 'a1'))[0]).toContain('Context 255k: a lot, not a limit.')
})

test("a subagent on the main session's own model shares its window, settings included", async ($, on) => {
  const usage = world(on, { tokens: 100_000, window: 300_000 })
  await step($, usage, undefined, 100_000, 'claude-fable-5-1')
  await step($, usage, 'a1', 185_000, 'claude-fable-5-1')
  expect((await nudges($, 'a1'))[0]).toContain('Context 185k: a lot, not a limit.')
})

test("an account without the million, seen on the main session's 1M model, caps a subagent's catalogue window", async ($, on) => {
  const usage = world(on, { tokens: 100_000, window: 200_000 })
  await step($, usage, undefined, 100_000, 'claude-fable-5-1')
  await step($, usage, 'a1', 125_000, 'claude-opus-5')
  expect((await nudges($, 'a1'))[0]).toContain('Context 125k: a lot, not a limit.')
})

test('a finished subagent leaves no ladder behind for an agent reusing its id', async ($, on) => {
  const usage = world(on, { tokens: 100_000 })
  await step($, usage, 'a1', 255_000)
  expect(await nudges($, 'a1')).toHaveLength(1)
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  expect(await nudges($, 'a1')).toEqual([])
  await step($, usage, 'a1', 255_000)
  expect(await nudges($, 'a1')).toHaveLength(1)
})

const COMPACT_ME = 'mcp__smart-compact__compact_me'

type World = { tokens: number; window?: number }

function world(on: On, start: World) {
  const clock = mock.clock(on)
  const state = { window: 1_000_000, ...start, calls: [] as string[], clock, isCompactHeld: false, release: () => {}, stepTokens: 0 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: state.tokens, window: state.window }, rateLimits: [] } }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', (_, e) => {
    state.calls.push(`${e.command}: ${e.args}`)
    if (!state.isCompactHeld) return {}
    return new Promise(done => { state.release = () => done({}) })
  })
  on('prompt.submit', (_, e) => {
    state.calls.push(`submit: ${e.text}`)
    return { text: e.text }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: 'done' }))
  on('turn.step', async function* (_, e) {
    const read = state.stepTokens - 3_000
    const usage = { input_tokens: 1_000, cache_read_input_tokens: read, cache_creation_input_tokens: 1_000, output_tokens: 1_000, model: 'm' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage } as never
  })
  return state
}

/** One model request of a subagent (or of the main session, no agentId) whose context ends at `tokens`. */
async function step($: Engine, state: { stepTokens: number }, agentId: string | undefined, tokens: number, model = 'm') {
  state.stepTokens = tokens
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model, messageCount: 1, agentId })) { /* drained */ }
}

async function queue($: Engine, focus: string) {
  const ran = await $.tool.call({ tool: COMPACT_ME, focus } as never)
  expect(ran.deny).toBeUndefined()
}

async function nudges($: Engine, agentId?: string) {
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)
  return [...(ran.context ?? [])]
}

function answered() {
  return { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
}
