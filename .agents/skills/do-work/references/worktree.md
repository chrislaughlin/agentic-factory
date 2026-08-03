# Worktree identity contract

Every approved work item has one identity that the parent passes unchanged to every specialist:

- **Git common directory** — canonical absolute output of `git rev-parse --path-format=absolute --git-common-dir`.
- **Control checkout** — canonical absolute repository root where the work item was initially invoked and from which local environment files are sourced.
- **Worktree** — canonical absolute path registered by `git worktree list --porcelain` for this item only.
- **Branch** — the task branch checked out in that worktree.
- **Baseline** — immutable commit from which the task branch was created.

Each delegation supplies a separate **expected revision**: the stage-specific commit the specialist must inspect or build upon.

Validate the identity with Git commands addressed to the worktree. The control checkout and worktree must resolve to the journaled common directory, the branch must match, and the worktree head must match the separately supplied expected revision. A missing checkout or registration, path collision, branch checked out in another worktree, mismatched common directory, or unexpected head is blocked.

Create the worktree only after plan approval. Keep the same identity through construction, verification, publication, monitoring, and remediation. Read-only reviewers must use commit-addressed operations when another stage may update the worktree concurrently.

## Environment bootstrap

Immediately after creating or recreating a worktree, copy the journaled control checkout's ignored local `.env` and `.env.*` regular files into the same relative paths in the new worktree. Tracked environment files and templates already come from the baseline and must not be overwritten. Before copying, detect matching tracked paths whose control-checkout content differs from the recorded baseline, including staged and unstaged changes. If any differ, block and report only their relative paths; proceeding would give the worktree stale configuration or make secrets committable.

Discover candidates without exposing their contents by consuming the NUL-delimited output of:

```sh
git -C <control-checkout> ls-files --others --ignored --exclude-standard -z -- ':(glob).env' ':(glob).env.*' ':(glob)**/.env' ':(glob)**/.env.*'
```

For each relative path:

- require the source to be a regular file physically contained in the control checkout; reject symlinks, directories, devices, and paths that escape it;
- require the destination path to be untracked, absent, and ignored according to the task worktree; a tracked or non-ignored collision is blocked so secrets cannot become committable;
- walk every destination parent from the task worktree root with non-following filesystem checks; reject any existing symlink or non-directory, create missing directories one level at a time, and verify the resolved parent remains physically contained in the task worktree;
- copy the file bytes and permission mode without interpolation or transformation;
- Never print, parse, compare, journal, or return file contents or environment-variable values. Report only the relative path and copy status.

Also detect matching untracked `.env` files that are not ignored. Do not copy them; block before delegation and require the repository to ignore them or the human to resolve them safely. Treat any copy or validation failure as blocked. Record the copied relative paths, but never their contents, in the journal's environment-bootstrap section. This is a one-time bootstrap when the worktree is created, not a synchronization mechanism; never overwrite an existing worktree's environment files on resume.

Every delegation includes the journaled environment-file paths. Before every checkpoint commit and push, revalidate that each path remains an untracked, ignored regular file physically contained in the task worktree and that no path appears in the Git index. A deleted file, changed ignore rule, staged environment file, symlink substitution, or containment failure is blocked. Never use forced staging to bypass this invariant.

The parent retains the worktree at human handoff and reports its path. Never remove it automatically. The human may remove it after inspection or merge with `git worktree remove <absolute-worktree-path>`; never recommend forced removal while it is dirty or contains unpushed commits.
