#!/usr/bin/env python3
"""Run deterministic planning-contract evaluations over committed sanitized artifacts.

This runner deliberately has no model, network, or secret access. It reads JSON
fixtures, validates recorded structured artifacts against the local Git revision
with the standard-library planning gate, and then scores their fields.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any


EXIT_PASS = 0
EXIT_ASSERTION_FAILURE = 1
EXIT_BLOCKED = 2
REVISION_RE = re.compile(r"^[0-9a-f]{40,64}$")
PATH_PART_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$")
VALIDATOR_PATH = Path(__file__).with_name("validate_planning_artifact.py")


class FixtureError(ValueError):
    """The committed evaluation input is missing or malformed."""


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise FixtureError(f"{label} must be a non-empty string")
    return value


def _assertions(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise FixtureError(f"{label} must be a non-empty list")
    result: list[dict[str, Any]] = []
    ids: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise FixtureError(f"{label}[{index}] must be an object")
        assertion_id = _text(item.get("id"), f"{label}[{index}].id")
        artifact_index = item.get("artifact_index")
        if not isinstance(artifact_index, int) or isinstance(artifact_index, bool) or artifact_index < 0:
            raise FixtureError(f"{label}[{index}].artifact_index must be a non-negative integer")
        path = _text(item.get("path"), f"{label}[{index}].path")
        if not all(PATH_PART_RE.fullmatch(part) for part in path.split(".")):
            raise FixtureError(f"{label}[{index}].path is not a supported artifact path")
        if "equals" not in item:
            raise FixtureError(f"{label}[{index}].equals is required")
        if set(item) != {"id", "artifact_index", "path", "equals"}:
            raise FixtureError(f"{label}[{index}] has unexpected fields")
        if assertion_id in ids:
            raise FixtureError(f"{label} contains duplicate id {assertion_id}")
        ids.add(assertion_id)
        result.append({
            "id": assertion_id,
            "artifact_index": artifact_index,
            "path": path,
            "equals": item["equals"],
        })
    return result


def load_fixture(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FixtureError(f"missing fixture: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise FixtureError(f"cannot read valid JSON fixture {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise FixtureError(f"fixture {path} must be an object")
    required = {
        "schema_version",
        "fixture_id",
        "expected_revision",
        "recorded_result",
        "required_assertions",
        "forbidden_matches",
    }
    if set(data) != required:
        missing = sorted(required - set(data))
        extra = sorted(set(data) - required)
        raise FixtureError(f"fixture {path} fields invalid; missing={missing}, extra={extra}")
    if data["schema_version"] != "planning-eval.v1":
        raise FixtureError(f"fixture {path} has unsupported schema_version")
    _text(data["fixture_id"], f"{path}.fixture_id")
    expected_revision = _text(data.get("expected_revision"), f"{path}.expected_revision")
    if not REVISION_RE.fullmatch(expected_revision):
        raise FixtureError(f"{path}.expected_revision must be a 40-64 character lowercase Git SHA")
    recorded = data["recorded_result"]
    if not isinstance(recorded, dict) or set(recorded) != {"source", "artifacts"}:
        raise FixtureError(f"fixture {path}.recorded_result must contain only source and artifacts")
    _text(recorded.get("source"), f"{path}.recorded_result.source")
    artifacts = recorded.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise FixtureError(f"{path}.recorded_result.artifacts must be a non-empty list")
    for index, artifact in enumerate(artifacts):
        if not isinstance(artifact, dict):
            raise FixtureError(f"{path}.recorded_result.artifacts[{index}] must be an object")
    data["required_assertions"] = _assertions(data["required_assertions"], f"{path}.required_assertions")
    forbidden = data["forbidden_matches"]
    if not isinstance(forbidden, list):
        raise FixtureError(f"{path}.forbidden_matches must be a list")
    if forbidden:
        data["forbidden_matches"] = _assertions(forbidden, f"{path}.forbidden_matches")
    else:
        data["forbidden_matches"] = []
    artifact_count = len(artifacts)
    for label in ("required_assertions", "forbidden_matches"):
        for index, assertion in enumerate(data[label]):
            if assertion["artifact_index"] >= artifact_count:
                raise FixtureError(
                    f"{path}.{label}[{index}].artifact_index is outside recorded_result.artifacts"
                )
    return data


def fixture_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise FixtureError(f"missing fixtures directory: {path}")
    paths = sorted(candidate for candidate in path.glob("*.json") if candidate.is_file())
    if not paths:
        raise FixtureError(f"fixtures directory contains no JSON fixtures: {path}")
    return paths


def _load_validator():
    spec = importlib.util.spec_from_file_location("planning_artifact_validator", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(f"cannot load artifact validator: {VALIDATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _lookup(document: Any, path: str) -> tuple[bool, Any]:
    value = document
    for part in path.split("."):
        match = PATH_PART_RE.fullmatch(part)
        if match is None:
            return False, None
        key, index = match.groups()
        if not isinstance(value, dict) or key not in value:
            return False, None
        value = value[key]
        if index is not None:
            if not isinstance(value, list) or int(index) >= len(value):
                return False, None
            value = value[int(index)]
    return True, value


def _strict_equal(left: Any, right: Any) -> bool:
    return type(left) is type(right) and left == right


def evaluate(path: Path, repository: Path = Path(__file__).resolve().parents[1]) -> dict[str, Any]:
    fixture = load_fixture(path)
    artifacts = fixture["recorded_result"]["artifacts"]
    validator = _load_validator()
    for index, artifact in enumerate(artifacts):
        try:
            validator.validate_artifact_document(
                artifact,
                fixture["expected_revision"],
                repository,
                stage="approval",
            )
        except (validator.ArtifactValidationError, KeyError, TypeError) as exc:
            raise FixtureError(
                f"{path}.recorded_result.artifacts[{index}] failed contract validation: {exc}"
            ) from exc
    required = fixture["required_assertions"]
    forbidden = fixture["forbidden_matches"]
    missing = []
    for item in required:
        index = item["artifact_index"]
        exists, value = _lookup(artifacts[index], item["path"]) if index < len(artifacts) else (False, None)
        if not exists or not _strict_equal(value, item["equals"]):
            missing.append(item["id"])
    forbidden_hits = []
    for item in forbidden:
        index = item["artifact_index"]
        exists, value = _lookup(artifacts[index], item["path"]) if index < len(artifacts) else (False, None)
        if exists and _strict_equal(value, item["equals"]):
            forbidden_hits.append(item["id"])
    return {
        "fixture_id": fixture["fixture_id"],
        "required_total": len(required),
        "required_matched": len(required) - len(missing),
        "missing_required": missing,
        "forbidden_total": len(forbidden),
        "forbidden_matched": len(forbidden_hits),
        "forbidden_hits": forbidden_hits,
    }


def run(path: Path) -> tuple[int, dict[str, Any]]:
    try:
        paths = fixture_paths(path)
        results = [evaluate(item) for item in paths]
    except FixtureError as exc:
        return EXIT_BLOCKED, {"status": "blocked", "reason": str(exc)}
    required_total = sum(item["required_total"] for item in results)
    required_matched = sum(item["required_matched"] for item in results)
    forbidden_matched = sum(item["forbidden_matched"] for item in results)
    status = "pass" if required_matched == required_total and forbidden_matched == 0 else "fail"
    exit_code = EXIT_PASS if status == "pass" else EXIT_ASSERTION_FAILURE
    return exit_code, {
        "status": status,
        "fixture_count": len(results),
        "required_assertions": required_total,
        "required_matched": required_matched,
        "required_recall_percent": 100.0 * required_matched / required_total,
        "forbidden_matches": forbidden_matched,
        "fixtures": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "planning-evals",
        help="a committed sanitized JSON fixture or directory of fixtures",
    )
    args = parser.parse_args(argv)
    code, result = run(args.fixtures)
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    sys.exit(main())
