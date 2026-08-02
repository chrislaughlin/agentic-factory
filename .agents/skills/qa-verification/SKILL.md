---
name: qa-verification
version: 1.0.0
description: Verify acceptance criteria against a running system and retain evidence.
triggers: [QA verification stage]
inputs: [source-change/v1, test-report/v1]
outputs: [qa-report/v1]
---

Remain source-read-only. Use runtime tools and record revision-bound evidence and typed findings.
