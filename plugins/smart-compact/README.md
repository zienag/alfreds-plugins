# smart-compact

**TL;DR:** the agent compacts early, between tasks, and the context stays small.

How:

1. Past a certain size, tool results carry a nudge: between tasks, compact.
   It gets more insistent as the context grows, each step said once.
2. The agent calls `compact_me` with a tweet-sized focus for the compactor:
   the task it continues with, the ones that are done. Not a summary.
3. When the turn ends, the mod runs `/compact` with that focus and sends
   "Context compacted. Continue the task." Nobody has to be at the keyboard.

Nudges start at 250k, 300k and 400k tokens in a 1M window, at 60%, 70% and
80% of a smaller one.

A subagent cannot be compacted, so on the same steps of its own context it is
asked to write a hand-over for a fresh agent and finish.

## Options

- `startAt`: first nudge, in thousands of tokens; the later steps follow in
  proportion (150 gives 150k, 180k, 240k). 0 is the ladder above.
- `beforeCompact`: a step the agent takes first, e.g. `run the debrief skill`.
- `summaryNote`: an instruction the compactor gets every time, e.g. the
  language of the summary.

Ask the agent ("start smart compaction at 150k"), or run
`claude plugin configure smart-compact@alfreds-plugins`.

## Install

```bash
claude plugin marketplace add zienag/alfreds-plugins
```

```bash
claude plugin install smart-compact@alfreds-plugins
```

## Working on it

`claude --plugin-dir plugins/smart-compact` loads the folder,
`claude plugin test plugins/smart-compact` runs the tests, and
[docs/smart-compact.md](../../docs/smart-compact.md) holds the engine facts
the design rests on.
