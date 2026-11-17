import type { Task } from '../types'

export const MINUTE = 60_000
export const MARKS = [3, 5, 10, 30, 60, 120]
export const EVERY = 120
const TAIL_LINES = 5
const LINE_WIDTH = 160
const COMMAND_WIDTH = 200

export type Schedule = { marks: number[]; every: number }

/** What an output file says: `done` when the engine wrote its exit line, so the command has ended. */
export type Output = { size: number; mtimeMs: number; tail: string[]; done: boolean }

/** The schedule from the options: `marks` as "3 5 10 30 60 120" in minutes of run time, `every` in minutes; the defaults where a value does not parse. */
export function schedule(marks: unknown, every: unknown): Schedule {
  const parsed = [...new Set(String(marks ?? '').split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
  const period = Number(every)
  return { marks: parsed.length > 0 ? parsed : MARKS, every: Number.isFinite(period) && period > 0 ? period : EVERY }
}

/** The first reminder time strictly after `now` for a task started at `startedAt`: the next mark, then every period past the last. */
export function nextReminder(startedAt: number, now: number, plan: Schedule): number {
  const elapsed = now - startedAt
  for (const mark of plan.marks) if (mark * MINUTE > elapsed) return startedAt + mark * MINUTE
  const last = plan.marks[plan.marks.length - 1] ?? 0
  const periods = Math.floor((elapsed - last * MINUTE) / (plan.every * MINUTE)) + 1
  return startedAt + (last + periods * plan.every) * MINUTE
}

/** The note in the tool result that moved the shell to the background. */
export function firstReminder(task: Task, now: number, plan: Schedule): string {
  const ahead = plan.marks.filter(mark => task.startedAt + mark * MINUTE > now)
  const when = ahead.length > 0
    ? `at ${list(ahead)} minutes of run time, then every ${plural(plan.every, 'minute')}`
    : `every ${plural(plan.every, 'minute')}`
  return `Background task ${task.id} is yours: \`${task.command}\`. Nobody else watches it. ` +
    `You will be reminded ${when}, with the tail of its output, until it ends or you stop it. ` +
    `When it is no longer needed: TaskStop ${task.id}.`
}

/** A reminder on the schedule, with what the output file says. */
export function reminder(task: Task, now: number, output: Output | null, plan: Schedule): string {
  const by = task.parent === null ? '' : ` It was started by subagent ${task.parent}, which has ended.`
  const next = elapsedText(nextReminder(task.startedAt, now, plan) - now)
  return `Reminder: background task ${task.id} (\`${task.command}\`) has run for ${elapsedText(now - task.startedAt)}.${by} ` +
    `${outputText(output, now)}\n` +
    `Is it still needed? If not, stop it: TaskStop ${task.id}. If it is, carry on; the next reminder comes in ${next}.`
}

/** The reason a subagent's end is held for the background commands that the engine kills when its turn ends. */
export function holdReason(tasks: Task[]): string {
  const listed = tasks.map(task => `- ${task.id}: \`${task.command}\`${task.output === null ? '' : `, output in ${task.output}`}`).join('\n')
  return `These background commands you started are still running:\n${listed}\n` +
    'You are a foreground subagent: they will be killed when you end your turn, and the one who called you gets no result. ' +
    'Wait for them now in the foreground (a Bash until-loop on the output file ending with "[exited with code", ' +
    'with a timeout), read the result and finish your report. ' +
    'A dev server cannot outlive you: if that is what a command is, say so in the report and end the turn again.'
}

export function toastText(task: Task, now: number): string {
  return `caffeine: ${task.id} has run for ${elapsedText(now - task.startedAt)}; the agent is reminded`
}

/** The output file's path from the backgrounding text, or null when it names none. */
export function outputPath(text: string): string | null {
  return /Output is being written to: (\S+?\.output)/.exec(text)?.[1] ?? null
}

/** The task id a completion notification names, or null for any other prompt. */
export function taskId(text: string): string | null {
  return /<task-id>([^<\s]+)<\/task-id>/.exec(text)?.[1] ?? null
}

/**
 * Whether an output ends with a line the engine writes when the command ends: the exit line, or `[killed]` when it
 * killed the shell itself, as it does to a subagent's shells when the subagent ends.
 */
export function hasExited(text: string): boolean {
  const end = text.slice(-200)
  return end.includes('[exited with code') || end.trimEnd().endsWith('[killed]')
}

/** The last non-empty lines of an output, each cut to a line's width. */
export function tailOf(text: string): string[] {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  return lines.slice(-TAIL_LINES).map(line => line.length > LINE_WIDTH ? `${line.slice(0, LINE_WIDTH - 1)}…` : line)
}

/** One line of a command or description, whitespace collapsed, cut to a width. */
export function squash(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > COMMAND_WIDTH ? `${line.slice(0, COMMAND_WIDTH - 1)}…` : line
}

export function elapsedText(ms: number): string {
  const minutes = Math.round(ms / MINUTE)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`
}

function outputText(output: Output | null, now: number): string {
  if (output === null) return 'No output file was found.'
  if (output.size === 0) return 'Its output file is still empty.'
  const changed = `Its output last changed ${elapsedText(now - output.mtimeMs)} ago, ${sizeText(output.size)} in all`
  if (output.tail.length === 0) return `${changed}.`
  return `${changed}; its last lines:\n${output.tail.map(line => `  ${line}`).join('\n')}`
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function list(numbers: number[]): string {
  if (numbers.length === 1) return String(numbers[0])
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
}
