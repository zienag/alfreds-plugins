# alfreds-plugins

## CHECKING A MOD
- The desktop app runs sessions headless, and the engine refuses or changes some calls there; a terminal REPL test proves nothing about the app. Probe the app's own binary with `-p`, as `docs/smart-compact.md` describes, and record engine facts there, never in a README.

## VCS
- Commit and push only when asked; green gates, a finished task or a version bump are not a request. Show the diff and wait.
- A release, even a minor version bump, needs a substantial gain: a serious bug fixed, a significant change or optimisation. It is made locally and not pushed, or pushed to a separate branch and merged later, so it can still be edited: once it is on main it has shipped, and a redo is another release.
