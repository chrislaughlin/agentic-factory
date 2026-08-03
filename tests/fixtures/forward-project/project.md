# Agent Factory project contract

## Repository
- Forge: github
- Remote: example/document-service
- Default branch: main
- Branch prefix: feature/

## Instructions and architecture
- Agent instructions: none
- Architecture sources: none
- Coding standards: Python standard library; keep request handling separate from process execution
- Additional required context: spec.md

## Environment
- Setup command: none
- Required services: none
- Required environment variables: none
- Development command: none

## Verification commands
- Focused tests: python3 -m unittest test_service.py
- Full tests: python3 -m unittest
- Lint: none
- Typecheck: none
- Build: none
- Security/dependency check: none

## QA
- Launch instructions: call the public Python function from a temporary directory
- Runtime surfaces: library
- Fixtures or test data: use temporary files only
- Required evidence: return value, created file, and error behavior

## Change publication
- PR/MR title convention: imperative
- PR/MR template: none
- Required local checks: full tests
- Required CI checks: repository-defined

## Monitoring
- Poll interval seconds: 60
- Timeout minutes: 60

## Human boundary
Agent Factory may create and update a ready-for-review PR/MR. It must never merge or deploy.
