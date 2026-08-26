#!/bin/sh
set -eu

usage() {
  printf '%s\n' 'Usage: scripts/install.sh [--harness all|codex|claude|opencode] [--mode copy|link] [--dest-home PATH]'
}

harness=all
mode=copy
dest_home=${HOME:?HOME must be set}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --harness)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      harness=$2
      shift 2
      ;;
    --mode)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      mode=$2
      shift 2
      ;;
    --dest-home)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      dest_home=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$harness" in all|codex|claude|opencode) ;; *) printf 'Unsupported harness: %s\n' "$harness" >&2; exit 2 ;; esac
case "$mode" in copy|link) ;; *) printf 'Unsupported mode: %s\n' "$mode" >&2; exit 2 ;; esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)

same_item() {
  source_item=$1
  target_item=$2
  if [ -L "$target_item" ]; then
    [ "$(readlink "$target_item")" = "$source_item" ]
  elif [ -f "$source_item" ] && [ -f "$target_item" ]; then
    cmp -s "$source_item" "$target_item"
  elif [ -d "$source_item" ] && [ -d "$target_item" ]; then
    diff -qr "$source_item" "$target_item" >/dev/null 2>&1
  else
    return 1
  fi
}

install_item() {
  source_item=$1
  target_item=$2
  target_parent=$(dirname -- "$target_item")
  item_name=$(basename -- "$target_item")
  mkdir -p "$target_parent"

  for backup_item in "$target_parent/${item_name}.agent-factory-backup-"*; do
    [ -e "$backup_item" ] || [ -L "$backup_item" ] || continue
    rm -rf -- "$backup_item"
    printf 'removed legacy backup %s\n' "$backup_item"
  done

  if [ -e "$target_item" ] || [ -L "$target_item" ]; then
    if same_item "$source_item" "$target_item"; then
      printf 'unchanged %s\n' "$target_item"
      return
    fi
    rm -rf -- "$target_item"
    printf 'updated %s\n' "$target_item"
  fi

  if [ "$mode" = link ]; then
    ln -s "$source_item" "$target_item"
  elif [ -d "$source_item" ]; then
    cp -R "$source_item" "$target_item"
  else
    cp "$source_item" "$target_item"
  fi
  printf 'installed %s\n' "$target_item"
}

install_skills() {
  skill_target=$1
  for skill_dir in "$repo_root"/.agents/skills/*; do
    [ -d "$skill_dir" ] || continue
    install_item "$skill_dir" "$skill_target/$(basename -- "$skill_dir")"
  done
}

install_codex() {
  install_skills "$dest_home/.agents/skills"
  for agent_file in "$repo_root"/adapters/codex/*.toml; do
    install_item "$agent_file" "$dest_home/.codex/agents/$(basename -- "$agent_file")"
  done
}

install_claude() {
  install_skills "$dest_home/.claude/skills"
  for agent_file in "$repo_root"/adapters/claude/*.md; do
    install_item "$agent_file" "$dest_home/.claude/agents/$(basename -- "$agent_file")"
  done
}

install_opencode() {
  install_skills "$dest_home/.config/opencode/skills"
  for agent_file in "$repo_root"/adapters/opencode/*.md; do
    install_item "$agent_file" "$dest_home/.config/opencode/agents/$(basename -- "$agent_file")"
  done
}

case "$harness" in
  all) install_codex; install_claude; install_opencode ;;
  codex) install_codex ;;
  claude) install_claude ;;
  opencode) install_opencode ;;
esac
