# Project contract template

Create `.agent-factory/project.md` with every heading below. Use `none` only after verifying that a command or source truly does not apply. Keep commands as literal executable invocations; do not wrap them in shell pipelines.

```markdown
# Agent Factory project contract

## Repository
- Forge: github | gitlab
- Remote: <owner/project or URL>
- Default branch: <branch>
- Branch prefix: <prefix>

## Instructions and architecture
- Agent instructions: <paths>
- Architecture sources: <paths>
- Coding standards: <paths>
- Additional required context: <paths>

## Environment
- Setup command: <command>
- Required services: <services or none>
- Required environment variables: <names only; never values>
- Development command: <command or none>

## Verification commands
- Focused tests: <command pattern>
- Full tests: <command>
- Lint: <command or none>
- Typecheck: <command or none>
- Build: <command or none>
- Security/dependency check: <command or none>

## QA
- Launch instructions: <steps>
- Runtime surfaces: browser | api | cli | library | other
- Fixtures or test data: <safe instructions>
- Required evidence: <screenshots, responses, logs, or other observable proof>

## Change publication
- PR/MR title convention: <convention>
- PR/MR template: <path or none>
- Required local checks: <checks>
- Required CI checks: <checks or repository-defined>

## Monitoring
- Poll interval seconds: 60
- Timeout minutes: 60

## Human boundary
Agent Factory may create and update a ready-for-review PR/MR. It must never merge or deploy.
```

Do not store tokens, credentials, secrets, personal test data, or environment-variable values. If runtime QA requires privileged access, describe how the human grants it through the harness rather than embedding it here.
