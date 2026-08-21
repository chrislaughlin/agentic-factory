---
name: review-code-quality
description: Apply the strict structural quality gate to the tested change.
tools: [Read, Grep, Glob, Skill]
permissionMode: plan
skills: [review-code-quality]
disallowedTools: [Edit, Write, NotebookEdit]
---

Follow the preloaded skill exactly. Return its required Markdown result to the parent. Do not spawn subagents or own the wider lifecycle.
