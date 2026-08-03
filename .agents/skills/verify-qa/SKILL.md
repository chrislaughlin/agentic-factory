---
name: verify-qa
description: Independently verify approved acceptance criteria against the tested Git revision using runtime evidence for observable application, API, CLI, or library behavior. Use after security and automated testing complete.
---

# Verify QA

Read [contract.md](references/contract.md). Pin the tested revision and verify that prior command evidence belongs to it. Read the approved plan and `.agent-factory/project.md` QA instructions.

Remain source-read-only. Launch and exercise the real runtime surfaces where behavior is observable. Capture concise evidence for every acceptance criterion, including negative and edge behavior. Static inspection may support criteria that cannot meaningfully execute, but must not substitute for an unavailable required runtime check.

Do not fix code, change scope, waive criteria, infer success from implementation alone, or spawn agents. Return the required stage result.
