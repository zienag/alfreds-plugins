export type Levels = readonly (readonly [start: number, step: number])[]

/** [start, step] for a 1M window, and the share of a smaller window a start is capped at. */
const LADDER = [
  [250_000, 25_000, 0.6],
  [300_000, 20_000, 0.7],
  [400_000, 10_000, 0.8],
] as const
export const FOCUS_LIMIT = 280

const FOCUS_DOC =
  'The focus is a tweet-size extra instruction for the compactor, so it understands your intent: ' +
  'which task you will continue. A summary or a retelling of key numbers and facts is FORBIDDEN here. ' +
  'For example: focus "focus on the auth bug fix; the deploy is finished".'

/** startAt (tokens) moves the whole ladder in proportion to its first start, whatever the window; 0 is automatic. */
export function levelsFor(window: number, startAt = 0): Levels {
  return LADDER.map(([start, step, share]) => {
    const scale = startAt > 0 ? startAt / LADDER[0][0] : Math.min(1, (share * window) / start)
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

const HANDOVER =
  'write a hand-over for a fresh agent (done, left, next step, dead ends, touched files) to a new file ' +
  'in the session scratchpad or a temporary directory and end. Open your reply with: the hand-over in <path> ' +
  'is for the next agent, no need to read it, just give that agent the path instead of resuming me.'

/** The subagent's ladder: nothing compacts a subagent, so it hands its work over instead. */
export function handoverText(tokens: number, levels: Levels): string {
  const [, [pressing = 0] = [], [urgent = 0] = []] = levels
  const size = `Context ${Math.floor(tokens / 1000)}k`
  if (tokens >= urgent) return `${size}. Stop now: ${HANDOVER}`
  if (tokens >= pressing) {
    return `${size}. Three quarters of your task done? Finish it. Less? At the next stopping point ${HANDOVER}`
  }
  return `${size}: a lot, not a limit. Two thirds of your task done? Carry on. Less? Finish the piece you are on, then ${HANDOVER}`
}

/** A request's whole context: what it read, cached or not, and what it wrote. */
export function contextTokens(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
}

export function squash(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ')
}

export function compactInstructions(focus: string, before: string, note: string): string {
  const routine = `Omit the compaction routine itself: context nudges, ${before ? 'the step before compacting, ' : ''}compact_me.`
  return [focus, routine, note].filter(Boolean).join(' ')
}

export function resumeText(): string {
  return 'Context compacted. Continue the task. If the turn before ended with a question to the user, wait for the answer instead.'
}
