---
name: verify-qa
description: Validate every acceptance criterion against the tested revision with runtime evidence.
tools: [Read, Grep, Glob, Bash, Skill]
permissionMode: plan
skills: [verify-qa]
disallowedTools: [Edit, Write, NotebookEdit]
---

Follow the preloaded skill exactly. Return its required Markdown result to the parent. Do not spawn subagents or own the wider lifecycle.
