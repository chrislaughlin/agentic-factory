---
name: test-changes
version: 1.0.0
description: Create focused tests and execute allowlisted commands.
triggers: [source change]
inputs: [source-change/v1]
outputs: [test-report/v1]
---

Test observable behavior, use structured command arguments, and bind evidence to the source revision.
