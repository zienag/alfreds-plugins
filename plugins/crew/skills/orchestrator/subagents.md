# Background jobs and subagents

How long-running work and spawned agents behave in Claude Code, and the ways each one stalls.

## Top level vs subagent: opposite rules

At the top level of a session, a long command (a build, a sync, a test run) goes to the background, and then you stop: do other useful work or end the turn. The task notification re-invokes you the instant it finishes. Never block on it and never sleep to wait; the only legitimate mid-flight check is a non-blocking peek at the tail of its output file.

Subagents live by the opposite rule, because that wakeup exists only at the top level. A spawned agent that ends its turn is finished; nothing ever resumes it, so "end the turn and wait for the notification" means stalling forever.

- As a subagent: run long commands in the foreground (one Bash call allows up to 10 minutes) or wait blockingly inside the turn. Never end the turn while a background job is alive.
- As the one spawning: put that instruction into every brief that may run long commands.

## A stalled worker

A worker gone idle with "waiting for the background job" is stalled. One SendMessage wake; if it goes idle again without a final report, it is dead: inspect its work in the tree and finish it yourself. Don't respawn a replacement; a half-done tree plus your context beats a fresh agent re-deriving it. The same holds for an agent that fails on a usage limit: it stops mid-turn with its edits in the tree and no report, and a replacement hits the same limit.

## What every brief must say

- A spawned agent's final text reaches you truncated at about 3,500 characters, cut mid-sentence, usually on the part you asked for last: the exclusion clause, the price table, the sources. So the brief says: write the full report to a file (give the path), reply with only that path and a summary under 100 words; you read the file. A word limit on the brief does not help; the cut is in characters of the notification, not in the agent's discipline.
- When the brief is a mechanical sweep (translate, rename, reformat), make the report ask for what the worker noticed and deliberately did not change. A worker that reads every line end to end is the cheapest anomaly detector you have.

## Messaging

- Spawned-agent finals and SendMessage replies are delivered only between turns. Never sleep or poll mid-turn waiting for one; end the turn and let the incoming message re-invoke you.
- Sending to a busy agent is safe, messages queue, but they do not land in time to steer: a message to an in-process subagent arrives once it has gone idle, after the work is done. There is no interrupt, only TaskStop.
- So requirements go in the brief; if they change after launch, let the agent land and fix the result yourself. Expect replies that crossed with your message to be stale; don't redo or revert the agent's work while it is still flying.

## Reading output, and verdicts

Never pipe a long or background command through `tail` or `head`: pipes buffer until the process exits, hiding all progress, so you can't tell if it's alive, stuck, or done. Background tasks already capture full output to a file; let it stream there unfiltered and read the file on demand. Filter on read, never at the source.

Same for verdicts: a pipeline's exit code is the last command's, so `swift test | tail` exits 0 over a red suite. Run gates as `cmd > log 2>&1; echo EXIT=$?` and grep the log after.

Same for facts: cropping a listing turns "fell off the bottom" into "does not exist". Select with `grep`, never crop what you're about to reason about.
