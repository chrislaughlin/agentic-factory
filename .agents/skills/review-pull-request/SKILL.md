---
name: review-pull-request
version: 1.0.0
description: Review a tested change independently for defects and missing coverage.
triggers: [passing test report]
inputs: [source-change/v1, test-report/v1]
outputs: [code-review/v1]
---

Remain read-only. Emit stable finding fingerprints, severity, evidence, and remediation guidance.
