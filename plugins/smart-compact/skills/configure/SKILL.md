---
name: configure
description: Smart compaction settings.
---

# smart-compact settings

The options live in the user's settings under
`pluginConfigs["smart-compact@<marketplace>"].options`. Read the current
values and the schema first; the plugin id is the one `claude plugin list`
shows for smart-compact:

```bash
claude plugin configure smart-compact@alfreds-plugins --json
```

- `startAt`: context size, in thousands of tokens, where the nudges start. The
  later steps keep their proportions: 150 gives 150, 180 and 240. 0 is
  automatic: 250k, 300k and 400k in a 1M window, capped at 60%, 70% and 80% of
  a smaller one. A set value is not capped by the window: steps the window
  never reaches stay silent, and the built-in auto-compact fires instead.
- `beforeCompact`: a step the agent takes before compacting, in lower case,
  since it follows "Between tasks or subtasks, ". Example: `run the debrief skill`.
- `summaryNote`: an instruction the compactor gets every time, such as the
  language of the summary.

Write only the options the user asked to change; the others keep their values.
Values are single-line strings, numbers included:

```bash
echo '{"startAt": "150"}' | claude plugin configure smart-compact@alfreds-plugins --values-stdin
```

The running session picks the new values up after `/reload-plugins`; tell the
user to run it, or that a new session will have them.
