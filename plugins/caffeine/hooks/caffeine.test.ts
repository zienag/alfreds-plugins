import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

test('a backgrounded shell gets its first reminder in the result, then the rest on the schedule with the output tail', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  const ran = await background($, 'b1', 'arc diff a b')
  expect(ran.context?.[0]).toContain('Background task b1 is yours: `arc diff a b`. Nobody else watches it.')
  expect(ran.context?.[0]).toContain('reminded at 3, 5, 10, 30, 60 and 120 minutes of run time, then every 120 minutes')
  w.files['/t/b1.output'] = { size: 30, mtimeMs: w.clock.now(), text: 'line one\nline two\n' }
  await w.clock.advance(MINUTE - 1)
  expect(w.rows()).toEqual([])
  await w.clock.advance(1)
  const [first] = w.rows()
  expect(first?.text).toContain('Reminder: background task b1 (`arc diff a b`) has run for 3 minutes.')
  expect(first?.text).toContain('Its output last changed 1 minute ago, 30 bytes in all; its last lines:\n  line one\n  line two')
  expect(first?.text).toContain('Is it still needed? If not, stop it: TaskStop b1. If it is, carry on; the next reminder comes in 2 minutes.')
  expect(first?.agentId).toBeUndefined()
  await w.clock.advance(6 * HOUR)
  expect(w.rows().map(r => /has run for ([^.]+)\./.exec(r.text)?.[1])).toEqual([
    '3 minutes', '5 minutes', '10 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '6 hours',
  ])
  expect(w.prompts).toEqual([])
})

test('a shell that finished in the foreground is not tracked', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(ran.context).toBeUndefined()
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test('the completion notification ends the reminders', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 200')
  await w.clock.advance(MINUTE)
  expect(w.rows()).toHaveLength(1)
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command done</summary>\n</task-notification>',
    origin: { kind: 'task-notification' }, wait: false,
  } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toHaveLength(1)
})

test('TaskStop ends the reminders', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 200')
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test('an idle session is woken with the reminder as a prompt and a toast; a running turn gets a row', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 200')
  await $.turn.complete(answered())
  await w.clock.advance(MINUTE)
  expect(w.rows()).toEqual([])
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toContain('Reminder: background task b1 (`sleep 200`) has run for 3 minutes. No output file was found.')
  expect(w.toasts).toEqual(['caffeine: b1 has run for 3 minutes; the agent is reminded'])
  await mainTurn($)
  await w.clock.advance(2 * MINUTE)
  expect(w.prompts).toHaveLength(1)
  expect(w.rows()).toHaveLength(1)
})

test("a background subagent's shell is reminded in its loop, and after the loop is gone in the main conversation, naming the subagent", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 900', { agentId: 'a1' })
  await w.clock.advance(MINUTE)
  expect(w.rows().map(r => r.agentId)).toEqual(['a1'])
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  expect(w.rows()).toHaveLength(1)
  await w.clock.advance(2 * MINUTE)
  expect(w.rows().map(r => r.agentId)).toEqual(['a1', 'a1'])
  w.gone.add('a1')
  await w.clock.advance(5 * MINUTE)
  const [, , later] = w.rows()
  expect(later?.agentId).toBeUndefined()
  expect(later?.text).toContain('has run for 10 minutes. It was started by subagent a1, which has ended.')
})

test("a subagent's shell that ends with the subagent is dropped when the subagent ends", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 900', { agentId: 'a1', endsWithCaller: true })
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test("a reminder refused by a subagent's gone loop goes to the main conversation, naming the subagent", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 900', { agentId: 'a1' })
  w.gone.add('a1')
  await w.clock.advance(MINUTE)
  const [row] = w.rows()
  expect(row?.agentId).toBeUndefined()
  expect(row?.text).toContain('It was started by subagent a1, which has ended.')
  await w.clock.advance(2 * MINUTE)
  expect(w.rows()).toHaveLength(2)
})

test('an output too large to read is reported by size and age, without a tail', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'yes')
  w.files['/t/b1.output'] = { size: 5 * 1024 * 1024, mtimeMs: w.clock.now(), text: 'never read' }
  await w.clock.advance(MINUTE)
  expect(w.rows()[0]?.text).toContain('Its output last changed 1 minute ago, 5.0 MB in all.\nIs it still needed?')
  expect(w.reads).toEqual([])
})

test('two shells backgrounded in parallel are both tracked', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await Promise.all([background($, 'b1', 'sleep 300'), background($, 'b2', 'sleep 400')])
  await w.clock.advance(MINUTE)
  expect(w.rows().map(r => /task (\w+) /.exec(r.text)?.[1]).sort()).toEqual(['b1', 'b2'])
})

test('the options set the marks and the period', { options: { marks: '1 3', every: 2 } }, async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  const ran = await background($, 'b1', 'sleep 300', { timedOutAfterMs: 0 })
  expect(ran.context?.[0]).toContain('reminded at 1 and 3 minutes of run time, then every 2 minutes')
  await w.clock.advance(7 * MINUTE)
  expect(w.rows().map(r => /has run for ([^.]+)\./.exec(r.text)?.[1])).toEqual(['1 minute', '3 minutes', '5 minutes', '7 minutes'])
})

test("a foreground subagent ending its turn with a shell the engine kills with it is held once; the second end passes and the shell is dropped", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  const held = await stopping($, 'a1')
  expect(held.block).toContain('These background commands you started are still running:\n- b1: `sleep 25`, output in /t/b1.output\n')
  expect(held.block).toContain('they will be killed when you end your turn')
  expect(held.block).toContain('Wait for them now in the foreground')
  expect(held.block).toContain('A dev server cannot outlive you')
  expect(held.block).not.toContain('nothing wakes you')
  expect((await stopping($, 'a1')).block).toBeUndefined()
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test("a background subagent ends freely with its shell running, and the main conversation is not told it is orphaned", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1' })
  expect((await stopping($, 'a1')).block).toBeUndefined()
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  expect(w.rows()).toEqual([])
  expect(w.prompts).toEqual([])
})

test('a subagent whose shell ended or was stopped, or that started none, ends without a hold', async ($, on) => {
  world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  await background($, 'b2', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
    origin: { kind: 'task-notification' }, wait: false,
  } as never)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b2' } as never)
  expect((await stopping($, 'a1')).block).toBeUndefined()
  expect((await stopping($, 'a2')).block).toBeUndefined()
})

test("a shell whose output ends with the exit line is no reason to hold, and a background subagent's is not handed over", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  await background($, 'b2', 'sleep 25', { agentId: 'a1' })
  const done = { size: 40, mtimeMs: w.clock.now(), text: 'PROBE_DONE\n\n[exited with code 0]\n' }
  w.files['/t/b1.output'] = done
  w.files['/t/b2.output'] = done
  expect((await stopping($, 'a1')).block).toBeUndefined()
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test("a background subagent's shell the engine killed when the subagent ended is not handed over", async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1' })
  w.files['/t/b1.output'] = { size: 10, mtimeMs: w.clock.now(), text: '[killed]\n' }
  await $.turn.complete({ ...answered(), agentId: 'a1' } as never)
  await w.clock.advance(3 * HOUR)
  expect(w.rows()).toEqual([])
})

test('a shell that exits while the subagent is held no longer holds it', async ($, on) => {
  const w = world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  w.files['/t/b1.output'] = { size: 5, mtimeMs: w.clock.now(), text: 'going\n' }
  expect((await stopping($, 'a1')).block).toContain('- b1: ')
  w.files['/t/b1.output'] = { size: 40, mtimeMs: w.clock.now(), text: 'going\nPROBE_DONE\n\n[exited with code 0]\n' }
  expect((await stopping($, 'a1')).block).toBeUndefined()
})

test("another loop's shells do not hold a subagent; a shell started after the first hold is held on its own", async ($, on) => {
  world(on)
  await $.session.start(started())
  await mainTurn($)
  await background($, 'b1', 'sleep 25')
  await background($, 'b2', 'sleep 25', { agentId: 'a2', endsWithCaller: true })
  expect((await stopping($, 'a1')).block).toBeUndefined()
  await background($, 'b3', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  expect((await stopping($, 'a1')).block).toContain('- b3: ')
  await background($, 'b4', 'sleep 25', { agentId: 'a1', endsWithCaller: true })
  const again = (await stopping($, 'a1')).block
  expect(again).toContain('- b4: ')
  expect(again).not.toContain('b3')
})

type File = { size: number; mtimeMs: number; text: string }

function world(on: On) {
  const clock = mock.clock(on)
  const appended: { agentId?: string; text: string }[] = []
  const w = {
    clock, prompts: [] as string[], toasts: [] as string[], reads: [] as string[], files: {} as Record<string, File>, gone: new Set<string>(),
    rows: () => appended,
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash' && typeof e.description === 'string' && e.description.startsWith('bg:')) {
      const [, id, timedOut, endsWithCaller] = e.description.split(':')
      const timedOutAfterMs = Number(timedOut)
      return {
        result: {
          stdout: '', stderr: '', interrupted: false, backgroundTaskId: id,
          ...(timedOutAfterMs > 0 ? { timedOutAfterMs } : {}),
          ...(endsWithCaller === 'yes' ? { backgroundEndsWithFinalResponse: true as const } : {}),
        },
        text: `Command running in background with ID: ${id}. Output is being written to: /t/${id}.output. You will be notified when it completes.`,
      }
    }
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    const file = w.files[e.path]
    if (file === undefined) return { deny: 'ENOENT' }
    return { value: { kind: 'file' as const, size: file.size, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    return { value: w.files[e.path]?.text ?? '' }
  })
  on('session.append', (_, e, next) => {
    if (e.agentId !== undefined && w.gone.has(e.agentId)) return { deny: 'no running loop' }
    if (e.door === 'note') appended.push({ agentId: e.agentId, text: textOf(e.message.content) })
    return next(e)
  })
  on('classic.SubagentStop', () => ({}))
  on('turn.complete', () => ({ text: 'done' }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return w
}

/** One Bash call the world answers as moved to the background under `id`, after the default timeout unless told otherwise. */
async function background($: Engine, id: string, command: string, extra: { agentId?: string; endsWithCaller?: boolean; timedOutAfterMs?: number } = {}) {
  const description = `bg:${id}:${extra.timedOutAfterMs ?? 120_000}:${extra.endsWithCaller === true ? 'yes' : 'no'}`
  const ran = await $.tool.call({ tool: 'Bash', command, description, agentId: extra.agentId } as never)
  expect(ran.deny).toBeUndefined()
  return ran
}

/** A subagent's end of turn, as the engine raises it to the settings hooks. */
function stopping($: Engine, agentId: string) {
  return $.classic.SubagentStop({ agent_id: agentId, agent_type: 'general-purpose', agent_transcript_path: '', stop_hook_active: false })
}

/** One model request of the main loop: the mod reads it as a turn under way. */
async function mainTurn($: Engine) {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })) { /* drained */ }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return (content as { type: string; text?: string }[]).map(block => block.text ?? '').join('')
}

function started() {
  return { cwd: '/tmp', surface: null, isInteractive: false }
}

function answered() {
  return { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
}
