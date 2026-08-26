#!/usr/bin/env python3
"""Validate Agent Factory's static skill and adapter contracts."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / ".agents" / "skills"
ADAPTERS = ROOT / "adapters"
AGENTS = ROOT / "agents"
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LINK_RE = re.compile(r"\[[^]]+\]\(([^)]+)\)")
REMOVED_PATHS = ["src", "test", "pnpm-lock.yaml", "tsconfig.json"]
CLAUDE_READ_ONLY_TOOLS = {"Read", "Grep", "Glob", "Skill"}
CLAUDE_DISALLOWED_EDIT_TOOLS = {"Edit", "Write", "NotebookEdit"}
OPENCODE_BASH_RE = re.compile(r"(?m)^\s*bash\s*:\s*(\S+)\s*$")


def frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if len(lines) < 4 or lines[0] != "---":
        raise ValueError("missing opening frontmatter delimiter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("missing closing frontmatter delimiter") from exc
    values: dict[str, str] = {}
    for line in lines[1:end]:
        if not line or line.startswith((" ", "\t")):
            continue
        if ":" not in line:
            raise ValueError(f"invalid frontmatter line: {line}")
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values, text


def inline_list(value: str | None) -> set[str] | None:
    """Parse the simple inline lists used by Claude adapter frontmatter."""
    if value is None or not (value.startswith("[") and value.endswith("]")):
        return None
    items = value[1:-1].split(",")
    return {
        item.strip().strip("\"'")
        for item in items
        if item.strip()
    }


def validate() -> list[str]:
    errors: list[str] = []
    skill_names = sorted(path.name for path in SKILLS.iterdir() if path.is_dir())
    expected_skills = {
        "shape-work",
        "do-work",
        "construct-work",
        "author-tests",
        "review-security",
        "verify-qa",
        "review-code-quality",
        "watch-change",
        "research-product",
        "challenge-product",
        "review-work-items",
        "map-codebase",
        "design-solution",
        "review-technical-plan",
        "show-me",
    }
    if set(skill_names) != expected_skills:
        errors.append(f"skill set mismatch: {skill_names}")

    for name in skill_names:
        path = SKILLS / name / "SKILL.md"
        try:
            meta, text = frontmatter(path)
        except (OSError, ValueError) as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")
            continue
        if set(meta) != {"name", "description"}:
            errors.append(f"{path.relative_to(ROOT)}: frontmatter must contain only name and description")
        if meta.get("name") != name or not NAME_RE.fullmatch(name):
            errors.append(f"{path.relative_to(ROOT)}: invalid or mismatched name")
        if len(meta.get("description", "")) < 40:
            errors.append(f"{path.relative_to(ROOT)}: description is not trigger-rich")
        if len(text.splitlines()) > 500:
            errors.append(f"{path.relative_to(ROOT)}: exceeds 500 lines")
        if "TODO" in text:
            errors.append(f"{path.relative_to(ROOT)}: contains TODO")
        for link in LINK_RE.findall(text):
            if "://" in link or link.startswith("#"):
                continue
            if not (path.parent / link).resolve().exists():
                errors.append(f"{path.relative_to(ROOT)}: broken reference {link}")
        ui = path.parent / "agents" / "openai.yaml"
        if not ui.is_file():
            errors.append(f"{ui.relative_to(ROOT)}: missing UI metadata")
        else:
            ui_text = ui.read_text(encoding="utf-8")
            if f"${name}" not in ui_text or "display_name:" not in ui_text:
                errors.append(f"{ui.relative_to(ROOT)}: invalid UI metadata")
            if name in {"do-work", "shape-work"} and "allow_implicit_invocation: false" not in ui_text:
                errors.append(f"{ui.relative_to(ROOT)}: user-invoked skill must disable implicit invocation")

    manifest = json.loads((AGENTS / "manifest.json").read_text(encoding="utf-8"))
    roles: dict[str, dict[str, str]] = manifest["roles"]
    role_names = set(roles)
    adapter_sets = {
        "canonical": {path.stem for path in AGENTS.glob("*.md")},
        "codex": {path.stem for path in (ADAPTERS / "codex").glob("*.toml")},
        "claude": {path.stem for path in (ADAPTERS / "claude").glob("*.md")},
        "opencode": {path.stem for path in (ADAPTERS / "opencode").glob("*.md")},
    }
    for adapter_name, adapter_roles in adapter_sets.items():
        if adapter_roles != role_names:
            errors.append(f"{adapter_name} role set mismatch: {sorted(adapter_roles)}")
    for name, role in roles.items():
        for path in [
            AGENTS / f"{name}.md",
            ADAPTERS / "codex" / f"{name}.toml",
            ADAPTERS / "claude" / f"{name}.md",
            ADAPTERS / "opencode" / f"{name}.md",
        ]:
            if not path.is_file():
                errors.append(f"missing adapter/agent: {path.relative_to(ROOT)}")
                continue
            text = path.read_text(encoding="utf-8")
            if name not in text:
                errors.append(f"{path.relative_to(ROOT)}: does not reference canonical role")
            if re.search(r"(?m)^\s*(model|model_reasoning_effort)\s*[:=]", text):
                errors.append(f"{path.relative_to(ROOT)}: pins a model")
        permission = role["permission"]
        codex = (ADAPTERS / "codex" / f"{name}.toml").read_text(encoding="utf-8")
        claude = (ADAPTERS / "claude" / f"{name}.md").read_text(encoding="utf-8")
        opencode = (ADAPTERS / "opencode" / f"{name}.md").read_text(encoding="utf-8")
        try:
            codex_data = tomllib.loads(codex)
            if set(("name", "description", "developer_instructions")) - set(codex_data):
                errors.append(f"Codex {name} lacks required agent fields")
            if codex_data.get("name") != name:
                errors.append(f"Codex {name} agent name does not match the canonical role")
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"Codex {name} is invalid TOML: {exc}")
        if permission == "read-only":
            if 'sandbox_mode = "read-only"' not in codex:
                errors.append(f"Codex {name} is not read-only")
            claude_meta, _ = frontmatter(ADAPTERS / "claude" / f"{name}.md")
            claude_tools = inline_list(claude_meta.get("tools"))
            if claude_tools != CLAUDE_READ_ONLY_TOOLS:
                errors.append(
                    f"Claude {name} must expose only read-only tools: "
                    f"{sorted(CLAUDE_READ_ONLY_TOOLS)}"
                )
            if claude_meta.get("permissionMode") != "plan":
                errors.append(f"Claude {name} must use permissionMode: plan")
            if inline_list(claude_meta.get("disallowedTools")) != CLAUDE_DISALLOWED_EDIT_TOOLS:
                errors.append(f"Claude {name} is not read-only")
            if "edit: deny" not in opencode:
                errors.append(f"OpenCode {name} is not read-only")
            bash_permissions = OPENCODE_BASH_RE.findall(opencode)
            if bash_permissions != ["allow"]:
                errors.append(f"OpenCode {name} must explicitly allow sandboxed bash")
        elif 'sandbox_mode = "workspace-write"' not in codex or "edit: allow" not in opencode:
            errors.append(f"{name} is missing write capability")

    for removed in REMOVED_PATHS:
        if (ROOT / removed).exists():
            errors.append(f"legacy runtime path remains: {removed}")
    if not (ROOT / "scripts" / "install.sh").is_file():
        errors.append("installer is missing")
    if not (ROOT / "README.md").is_file():
        errors.append("README is missing")
    contracts = {
        "planning-result.v1": ROOT / "contracts" / "planning-result-v1.json",
        "technical-blueprint.v1": ROOT / "contracts" / "technical-blueprint-v1.json",
    }
    for version, path in contracts.items():
        try:
            contract = json.loads(path.read_text(encoding="utf-8"))
            if contract.get("$id") != f"agent-factory/{version.replace('.', '/')}":
                errors.append(f"{path.relative_to(ROOT)}: invalid contract id")
            if contract.get("type") != "object" or not contract.get("required"):
                errors.append(f"{path.relative_to(ROOT)}: contract must define required object fields")
            required = set(contract.get("required", []))
            for field in {"schema_version", "kind", "role", "artifact_id", "baseline_sha", "content_hash", "status", "unresolved_decisions", "acceptance_mapping", "verification_mapping"}:
                if field not in required:
                    errors.append(f"{path.relative_to(ROOT)}: missing required planning field {field}")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path.relative_to(ROOT)}: unreadable contract: {exc}")
    if not (ROOT / "scripts" / "evaluate_planning.py").is_file():
        errors.append("planning evaluator is missing")
    if not (ROOT / "scripts" / "validate_planning_artifact.py").is_file():
        errors.append("planning artifact validator is missing")
    planning = ROOT / ".agents" / "skills" / "do-work" / "references" / "planning.md"
    if planning.is_file() and "validate_planning_artifact.py" not in planning.read_text(encoding="utf-8"):
        errors.append("planning artifact validator is not wired into the do-work gate")
    return errors


if __name__ == "__main__":
    failures = validate()
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        sys.exit(1)
    print("Agent Factory static contracts are valid.")
