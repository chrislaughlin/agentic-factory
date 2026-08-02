---
name: repository-analysis
version: 1.0.0
description: Discover repository structure and conventions before planning.
triggers: [new work request, unfamiliar repository]
inputs: [work-request/v1]
outputs: [repository observations]
---

Read manifests, documentation, configuration, and relevant code. Report evidence; never edit files.
