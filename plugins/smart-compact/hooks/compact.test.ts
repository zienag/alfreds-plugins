import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

test('a queued focus compacts after the answer, then the task continues', async ($, on) => {
  const { calls, clock } = world(on, { tokens: 100_000 })
  await queue($, 'focus on the auth bug fix; the deploy is finished')
  expect(calls).toEqual([])
  await $.turn.complete(answered())
  await clock.settle()
  expect(calls).toEqual([
    'compact: focus on the auth bug fix; the deploy is finished Omit the compaction routine itself: context nudges, compact_me.',
    'submit: [smart-compact] Context compacted. Continue the task.',
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
  expect(held.calls[1]).toEqual('submit: [smart-compact] Context compacted. Continue the task.')
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

test('a 200k window is nudged from 60% of it, before the built-in auto-compact', async ($, on) => {
  const usage = world(on, { tokens: 110_000, window: 200_000 })
  expect(await nudges($)).toEqual([])
  usage.tokens = 121_000
  expect((await nudges($))[0]).toContain('Context 121k > 120k. Between tasks')
  usage.tokens = 161_000
  expect((await nudges($))[0]).toContain('Context 161k > 160k. Compact immediately')
})

test('a subagent tool call is never nudged', async ($, on) => {
  world(on, { tokens: 420_000 })
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  expect(ran.context ?? []).toEqual([])
})

const COMPACT_ME = 'mcp__smart-compact__compact_me'

type World = { tokens: number; window?: number }

function world(on: On, start: World) {
  const clock = mock.clock(on)
  const state = { window: 1_000_000, ...start, calls: [] as string[], clock, isCompactHeld: false, release: () => {} }
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
  return state
}

async function queue($: Engine, focus: string) {
  const ran = await $.tool.call({ tool: COMPACT_ME, focus } as never)
  expect(ran.deny).toBeUndefined()
}

async function nudges($: Engine) {
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  return [...(ran.context ?? [])]
}

function answered() {
  return { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
}
