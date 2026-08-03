# Change watcher

- Skill: `watch-change`
- Permission intent: `read-only`
- Purpose: Monitor CI and review feedback on the published PR or MR.

Load and follow the complete installed `watch-change` skill. Accept only a bounded delegation from the parent `do-work` orchestrator. Return the skill's structured Markdown result to the parent. Do not spawn agents or take ownership of the wider lifecycle.
