---
name: setup-agent-factory
description: Configure a Git repository to use the portable Agent Factory skills. Use when a human explicitly asks to initialize or update the repository's project contract, verification commands, forge settings, QA instructions, and ignored work journals.
---

# Set Up Agent Factory

Inspect the repository before asking questions. Read agent instructions, manifests, CI configuration, contribution docs, architecture docs, test setup, remotes, and default branch. Infer every discoverable fact.

Use [project-template.md](references/project-template.md) as the required contract.

Ask one unresolved material question at a time and recommend an answer. Confirm commands rather than inventing them; run safe read-only or validation commands when useful.

Create or update `.agent-factory/project.md` without overwriting project-specific guidance. Ensure `.agent-factory/.gitignore` contains exactly the `work/` ignore needed for journals. Do not ignore `project.md`.

Report what was discovered, what was configured, and any prerequisites the human must still supply. Do not start a work item automatically.
