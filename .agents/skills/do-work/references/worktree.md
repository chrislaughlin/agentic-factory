# Worktree identity contract

Every approved work item has one identity that the parent passes unchanged to every specialist:

- **Git common directory** — canonical absolute output of `git rev-parse --path-format=absolute --git-common-dir`.
- **Worktree** — canonical absolute path registered by `git worktree list --porcelain` for this item only.
- **Branch** — the task branch checked out in that worktree.
- **Baseline** — immutable commit from which the task branch was created.

Each delegation supplies a separate **expected revision**: the stage-specific commit the specialist must inspect or build upon.

Validate the identity with Git commands addressed to the worktree. Its common directory and branch must match the journal, and its head must match the separately supplied expected revision. A missing registration, path collision, branch checked out in another worktree, mismatched common directory, or unexpected head is blocked.

Create the worktree only after plan approval. Keep the same identity through construction, verification, publication, monitoring, and remediation. Read-only reviewers must use commit-addressed operations when another stage may update the worktree concurrently.

The parent retains the worktree at human handoff and reports its path. Never remove it automatically. The human may remove it after inspection or merge with `git worktree remove <absolute-worktree-path>`; never recommend forced removal while it is dirty or contains unpushed commits.
