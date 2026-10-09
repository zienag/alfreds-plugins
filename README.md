# alfreds-plugins

Claude Code mods I use myself.

```bash
claude plugin marketplace add zienag/alfreds-plugins
```

| Plugin | What it does |
| --- | --- |
| [smart-compact](plugins/smart-compact) | The agent compacts its own context between tasks, with a focus it writes for the compactor, and carries on by itself. |
| [crew](plugins/crew) | Subagents in three tiers, split by who makes the decisions, a teamlead for a whole slice, and the orchestrator skill that runs a session through them. |

```bash
claude plugin install smart-compact@alfreds-plugins
```

```bash
claude plugin install crew@alfreds-plugins
```
