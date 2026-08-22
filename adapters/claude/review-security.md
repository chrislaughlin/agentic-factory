---
name: review-security
description: Audit the pinned construction revision and report validated security risks.
tools: [Read, Grep, Glob, Skill]
permissionMode: plan
skills: [review-security]
disallowedTools: [Edit, Write, NotebookEdit]
---

Follow the preloaded skill exactly. Return its required Markdown result to the parent. Do not spawn subagents or own the wider lifecycle.
