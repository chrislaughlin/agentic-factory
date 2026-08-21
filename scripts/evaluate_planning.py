#!/usr/bin/env python3
"""Run deterministic planning-contract evaluations over committed sanitized results.

This runner deliberately has no model, network, repository, or secret access. It
only reads JSON fixtures and recorded result text supplied on disk.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


EXIT_PASS = 0
EXIT_ASSERTION_FAILURE = 1
EXIT_BLOCKED = 2


class FixtureError(ValueError):
    """The committed evaluation input is missing or malformed."""


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise FixtureError(f"{label} must be a non-empty string")
    return value


def _assertions(value: Any, label: str) -> list[dict[str, str]]:
    if not isinstance(value, list) or not value:
        raise FixtureError(f"{label} must be a non-empty list")
    result: list[dict[str, str]] = []
    ids: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise FixtureError(f"{label}[{index}] must be an object")
        assertion_id = _text(item.get("id"), f"{label}[{index}].id")
        needle = _text(item.get("match"), f"{label}[{index}].match")
        if set(item) != {"id", "match"}:
            raise FixtureError(f"{label}[{index}] has unexpected fields")
        if assertion_id in ids:
            raise FixtureError(f"{label} contains duplicate id {assertion_id}")
        ids.add(assertion_id)
        result.append({"id": assertion_id, "match": needle})
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
    required = {"schema_version", "fixture_id", "recorded_result", "required_assertions", "forbidden_matches"}
    if set(data) != required:
        missing = sorted(required - set(data))
        extra = sorted(set(data) - required)
        raise FixtureError(f"fixture {path} fields invalid; missing={missing}, extra={extra}")
    if data["schema_version"] != "planning-eval.v1":
        raise FixtureError(f"fixture {path} has unsupported schema_version")
    _text(data["fixture_id"], f"{path}.fixture_id")
    recorded = data["recorded_result"]
    if not isinstance(recorded, dict) or set(recorded) != {"source", "text"}:
        raise FixtureError(f"fixture {path}.recorded_result must contain only source and text")
    _text(recorded.get("source"), f"{path}.recorded_result.source")
    _text(recorded.get("text"), f"{path}.recorded_result.text")
    data["required_assertions"] = _assertions(data["required_assertions"], f"{path}.required_assertions")
    forbidden = data["forbidden_matches"]
    if not isinstance(forbidden, list):
        raise FixtureError(f"{path}.forbidden_matches must be a list")
    if forbidden:
        data["forbidden_matches"] = _assertions(forbidden, f"{path}.forbidden_matches")
    else:
        data["forbidden_matches"] = []
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


def evaluate(path: Path) -> dict[str, Any]:
    fixture = load_fixture(path)
    text = fixture["recorded_result"]["text"]
    required = fixture["required_assertions"]
    forbidden = fixture["forbidden_matches"]
    missing = [item["id"] for item in required if item["match"] not in text]
    forbidden_hits = [item["id"] for item in forbidden if item["match"] in text]
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
