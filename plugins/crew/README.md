# crew

**TL;DR:** subagents in three tiers, split by who makes the decisions, a
teamlead for a whole slice, and the orchestrator skill that runs a session
through them. Say "orchestrator mode" to start.

## Install

```bash
claude plugin marketplace add zienag/alfreds-plugins
```

```bash
claude plugin install crew@alfreds-plugins
```

## The crew

- `crew:solid`, the default worker: it chooses the route itself, and a wrong
  choice is cheap to catch.
- `crew:fast`: the brief has made every decision, the worker carries it out
  and stops when reality departs from the brief.
- `crew:deep`: being wrong is expensive; a design decision, a bug with no
  known cause, a review meant to find what is broken.
- `crew:teamlead`: a sub-orchestrator for a slice too big for one task and
  too detailed for the lead's window; it delegates down the same way.

Every worker reports in one shape: the claim, the evidence, file paths for
anything long, what is open. Never a transcript.

## The skill

`crew:orchestrator` turns the session into the tech lead: it keeps judgment,
decomposition, verification and the conversation, and hands the hands-on work
to the crew. The skill folder also holds the harness facts about subagents
(what stalls them, what every brief must say) the lead and the teamlead read.
