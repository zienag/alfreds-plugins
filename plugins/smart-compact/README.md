# smart-compact

**TL;DR:** the agent compacts itself gracefully: at a moment of its own
choosing, between tasks, with the one it is on finished. Settings: ask the
agent, "what are the smart-compact settings?"

## Install

```bash
claude plugin marketplace add zienag/alfreds-plugins
```

```bash
claude plugin install smart-compact@alfreds-plugins
```

## Why

Auto-compact fires at a fixed size, high up in a 1M window, at a random point
of the task. The model does not see it coming and finishes nothing before it,
so the work can come out broken. A lower limit does not help: for some tasks
the right call is to go on a little and finish, then compact. A hard line is
the wrong tool.

This mod asks instead. Past a certain size, tool results carry a nudge to
compact between tasks, more insistent as the context grows, each step said
once. The agent calls `compact_me` with a tweet-sized focus for the compactor
(the task it continues with, the ones that are done) and ends the turn. The
mod runs `/compact` with that focus and sends "Context compacted. Continue the
task." Nobody has to be at the keyboard.

A subagent has no auto-compact at all, and the main agent can hand the same
subagent task after task while its context grows unwatched. So on the same
steps of its own context, against its own model's window, a subagent is asked
to finish at a good point and return to its parent either the finished work or
a hand-over for a fresh agent.

Nudges start at 250k, 300k and 400k tokens in a 1M window, at 60%, 70% and
80% of a smaller one.

## Options

- `startAt`: first nudge, in thousands of tokens; the later steps follow in
  proportion (150 gives 150k, 180k, 240k). 0 is the ladder above.
- `beforeCompact`: a step the agent takes first, e.g. `run the debrief skill`.
- `summaryNote`: an instruction the compactor gets every time, e.g. the
  language of the summary.

Ask the agent, or run `claude plugin configure smart-compact@alfreds-plugins`.

## Working on it

`claude --plugin-dir plugins/smart-compact` loads the folder,
`claude plugin test plugins/smart-compact` runs the tests, and
[docs/smart-compact.md](../../docs/smart-compact.md) holds the engine facts
the design rests on.
