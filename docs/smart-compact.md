# smart-compact: engine facts the design rests on

Working notes for whoever changes the mod. Each fact names how it was checked
and on which Claude Code build; recheck on a build that changes the hooks API.

## How 0.2.1 was checked end to end

One headless run of the app's 2.1.293 binary with the installed plugin, the
prompt asking for two parallel Bash calls, an empty-focus `compact_me`, then a
real one, with `startAt` set to 10 through `--settings` so the ladder is in
reach. Read from the run's stream and its transcript file:

- `compact_me` is in the tool list at init and was called without a ToolSearch.
- The two parallel calls produced one `hook_additional_context` record, one
  nudge.
- The empty focus came back as a tool error with the mod's text.
- After the answer, `/compact` ran (31.8k to 7.3k tokens), then the model got
  "The smart-compact plugin sent a message: Context compacted. Continue the
  task..." and answered it.

The stream (`--output-format stream-json`) does not show hook context or a
plugin's prompt; the session's transcript file under `~/.claude/projects/`
does.

## The compaction runs as `/compact`, not `$.session.compact`

The desktop app runs its sessions headless (the SDK path), and there
`$.session.compact` is refused:

```
$.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on
```

Seen on 2.1.288 in the app itself and on 2.1.293 with the app's own binary run
as `claude -p --input-format stream-json`. The terminal REPL accepts the same
call from a zero-delay timer after `turn.complete` (checked on 2.1.294), so a
terminal test proves nothing about the app. `$.command.run({ command:
'compact', args })` works in both; its price is that a compaction a hook vetoed
is not visible to the mod, the engine only prints the veto.

To check the app's behaviour without the app: run the app's binary from
`~/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude`
with `-p --input-format stream-json --output-format stream-json --plugin-dir
<probe>`, keep stdin open with a `sleep` after the first JSON line, and have
the probe log through `$.fs.write`.

## A prompt typed mid-turn does not come between the answer and the compaction

The engine queues every prompt typed while a turn runs and delivers it into
that turn: its `prompt.submit` carries the running turn's `turnId`. A plugin's
`$.command.run` and `$.prompt.submit` wait for the session to be idle. So the
order is the answer, then `/compact`, then the continue prompt.

## The tool sits in the prompt's tool list

A tool from `$.tool.register` has two placements, set by `isDeferred`. Left
out or `true`: behind ToolSearch, the model sees the name in the deferred list
and must load the schema with a ToolSearch call before it can call the tool.
`false`: the schema is in the tool list from the first turn. `compact_me` uses
`false`, so the nudged agent calls it in one step; the schema is one string
field, about a hundred prompt tokens, cached.

## The ladder's memory is a module variable

Parallel tool calls dispatch `tool.call` concurrently. With the nudged level in
`$.state`, each call read the old level, decided to nudge, and wrote: one
nudge per call (reproduced in the test kit with two calls in `Promise.all`). A
module variable is read and written synchronously after the one `await` on
usage, so the second call sees the first's write. A reload of the mod starts
the variable over, which costs at most one repeated nudge at the current step.

## The continue prompt carries no marker

The engine frames a plugin's prompt for the model as "The smart-compact plugin
sent a message: ..." and explains that it starts the turn in the user's place,
so the text itself needs no tag.
