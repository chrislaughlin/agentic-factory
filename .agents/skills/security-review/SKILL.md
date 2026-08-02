---
name: security-review
version: 1.0.0
description: Perform a read-only threat-focused review.
triggers: [security verification stage]
inputs: [source-change/v1]
outputs: [security-review/v1]
---

Review trust boundaries, injection risks, authorization, secret handling, and dependency exposure.
