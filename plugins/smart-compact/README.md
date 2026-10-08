# smart-compact

A Claude Code mod that lets the agent compact its own context at a moment it
chooses, instead of waiting for the built-in auto-compact to fire in the middle
of whatever it is doing.

## What it does

- As the context grows, the agent gets a short note after a tool call: first
  "between tasks or subtasks, compact", then more insistent, then "compact
  immediately". Each step is said once; after a compaction the ladder starts over.
- The agent calls the `compact_me` tool with a focus: a tweet-size instruction
  for the compactor that names the task it will continue and the finished ones.
  A focus over 280 characters is refused.
- When the turn ends, the mod runs `/compact` with that focus and then sends
  "Context compacted. Continue the task.", so the work goes on without you.

An interrupted turn drops the queued compaction. A subagent cannot compact the
main session and is never nudged. If the mod reloads while `/compact` runs, the
continue message is still sent, once.

## When it nudges

The steps start at 250k, 300k and 400k tokens, repeating every 25k, 20k and 10k
tokens past each start. In a window smaller than 1M the starts are capped at 60%,
70% and 80% of the window and the repeats shrink with them: in a 200k window
the nudges start at 120k, 140k and 160k, before the built-in auto-compact.

## Options

Both are empty by default; set them in `/config`, with
`claude plugin configure smart-compact`, or in settings.json under
`pluginConfigs["smart-compact@alfreds-plugins"].options`.

- `beforeCompact`: a step the agent takes before it compacts, written in lower
  case to follow "Between tasks or subtasks, ", for example
  `run the debrief skill`.
- `summaryNote`: an extra instruction the compactor gets every time, for
  example the language to write the summary in.

## Install

```bash
claude plugin marketplace add zienag/alfreds-plugins
```

```bash
claude plugin install smart-compact@alfreds-plugins
```

To work on it, load the folder instead: `claude --plugin-dir plugins/smart-compact`.

## Tests

```bash
claude plugin test plugins/smart-compact
```
