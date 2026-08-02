---
name: implement-work-item
version: 1.0.0
description: Implement an approved plan or remediation request.
triggers: [approved plan, remediation request]
inputs: [implementation-plan/v1, remediation-request/v1]
outputs: [source-change/v1]
---

Modify only approved scope. Inspect the diff and report changed paths and the resulting revision.
