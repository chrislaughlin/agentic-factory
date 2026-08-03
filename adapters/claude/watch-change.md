---
name: watch-change
description: Monitor CI and review feedback on the published PR or MR.
tools: [Read, Grep, Glob, Bash, Skill]
permissionMode: plan
skills: [watch-change]
disallowedTools: [Edit, Write, NotebookEdit]
---

Follow the preloaded skill exactly. Return its required Markdown result to the parent. Do not spawn subagents or own the wider lifecycle.
