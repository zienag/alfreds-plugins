export type Levels = readonly (readonly [start: number, step: number])[]

/** [start, step] for a 1M window, and the share of a smaller window a start is capped at. */
const LADDER = [
  [250_000, 25_000, 0.6],
  [300_000, 20_000, 0.7],
  [400_000, 10_000, 0.8],
] as const
export const FOCUS_LIMIT = 280
export const MARK = '[smart-compact]'

const FOCUS_DOC =
  'The focus is a tweet-size extra instruction for the compactor, so it understands your intent: ' +
  'which task you will continue. A summary or a retelling of key numbers and facts is FORBIDDEN here. ' +
  'For example: focus "focus on the auth bug fix; the deploy is finished".'

export function levelsFor(window: number): Levels {
  return LADDER.map(([start, step, share]) => {
    const scale = Math.min(1, (share * window) / start)
    return [Math.round(start * scale), Math.round(step * scale)] as const
  })
}

export function levelFor(tokens: number, levels: Levels): number {
  let level = 0
  for (const [start, step] of levels) {
    if (tokens >= start) level = start + Math.floor((tokens - start) / step) * step
  }
  return level
}

/** [level to nudge about or null, level to remember]; a size that fell re-arms the ladder. */
export function decide(tokens: number, nudged: number, levels: Levels): [number | null, number] {
  const level = levelFor(tokens, levels)
  return [level > nudged ? level : null, level]
}

export function nudgeText(tokens: number, first: boolean, levels: Levels, before: string, tool: string): string {
  const [[calm = 0] = [], [pressing = 0] = [], [urgent = 0] = []] = levels
  const how = `${before ? `${before}, then ` : ''}call the tool \`${tool}\` with a focus and end the turn.`
  const k = (n: number) => Math.floor(n / 1000)
  let text
  if (tokens >= urgent) text = `Context ${k(tokens)}k > ${k(urgent)}k. Compact immediately: ${how}`
  else if (tokens >= pressing) {
    text = `Context ${k(tokens)}k > ${k(pressing)}k. Strongly advised to compact already: at the next gap between subtasks, ${how}`
  } else text = `Context ${k(tokens)}k > ${k(calm)}k. Between tasks or subtasks, ${how}`
  return first ? `${text} ${FOCUS_DOC}` : text
}

export function squash(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ')
}

export function compactInstructions(focus: string, before: string, note: string): string {
  const routine = `Omit the compaction routine itself: context nudges, ${before ? 'the step before compacting, ' : ''}compact_me.`
  return [focus, routine, note].filter(Boolean).join(' ')
}

export function resumeText(): string {
  return `${MARK} Context compacted. Continue the task.`
}
