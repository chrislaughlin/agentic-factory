#!/usr/bin/env python3
"""Validate planning-artifact integrity against a local Git revision."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")
CONTENT_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CONTRACTS = {
    "planning-result.v1": ROOT / "contracts" / "planning-result-v1.json",
    "technical-blueprint.v1": ROOT / "contracts" / "technical-blueprint-v1.json",
}


class ArtifactValidationError(ValueError):
    """The artifact cannot be trusted for exact-artifact review."""


def canonicalize_artifact(artifact: Any) -> bytes:
    """Return canonical UTF-8 JSON with only content_hash omitted."""
    if not isinstance(artifact, dict):
        raise ArtifactValidationError("artifact must be a JSON object")
    without_hash = {key: value for key, value in artifact.items() if key != "content_hash"}
    try:
        canonical = json.dumps(
            without_hash,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ArtifactValidationError(f"artifact cannot be canonicalized: {exc}") from exc
    return canonical.encode("utf-8")


def _load_artifact(path: Path) -> dict[str, Any]:
    try:
        artifact = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ArtifactValidationError(f"cannot read valid JSON artifact {path}: {exc}") from exc
    if not isinstance(artifact, dict):
        raise ArtifactValidationError("artifact must be a JSON object")
    return artifact


def _resolve_schema_ref(reference: str, schema: dict[str, Any]) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise ArtifactValidationError(f"unsupported contract reference {reference}")
    resolved: Any = schema
    for part in reference[2:].split("/"):
        if not isinstance(resolved, dict) or part not in resolved:
            raise ArtifactValidationError(f"contract reference does not resolve: {reference}")
        resolved = resolved[part]
    if not isinstance(resolved, dict):
        raise ArtifactValidationError(f"contract reference is not an object schema: {reference}")
    return resolved


def _validate_schema(value: Any, schema: dict[str, Any], path: str, root: dict[str, Any]) -> None:
    if "$ref" in schema:
        _validate_schema(value, _resolve_schema_ref(schema["$ref"], root), path, root)
        return

    if "const" in schema and value != schema["const"]:
        raise ArtifactValidationError(f"{path} must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise ArtifactValidationError(f"{path} has an unsupported value")

    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(value, dict):
            raise ArtifactValidationError(f"{path} must be an object")
        required = schema.get("required", [])
        missing = [field for field in required if field not in value]
        if missing:
            raise ArtifactValidationError(f"{path} is missing required fields: {', '.join(missing)}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unexpected = sorted(set(value) - set(properties))
            if unexpected:
                raise ArtifactValidationError(
                    f"{path} has unexpected fields: {', '.join(unexpected)}"
                )
        for field, field_schema in properties.items():
            if field in value:
                _validate_schema(value[field], field_schema, f"{path}.{field}", root)
        return

    if expected_type == "array":
        if not isinstance(value, list):
            raise ArtifactValidationError(f"{path} must be an array")
        min_items = schema.get("minItems")
        if min_items is not None and len(value) < min_items:
            raise ArtifactValidationError(f"{path} must contain at least {min_items} item(s)")
        item_schema = schema.get("items")
        if item_schema is not None:
            for index, item in enumerate(value):
                _validate_schema(item, item_schema, f"{path}[{index}]", root)
        return

    if expected_type == "string":
        if not isinstance(value, str):
            raise ArtifactValidationError(f"{path} must be a string")
        min_length = schema.get("minLength")
        if min_length is not None and len(value) < min_length:
            raise ArtifactValidationError(f"{path} must not be empty")
        pattern = schema.get("pattern")
        if pattern is not None and re.fullmatch(pattern, value) is None:
            raise ArtifactValidationError(f"{path} has an invalid format")
        return

    if expected_type == "boolean" and not isinstance(value, bool):
        raise ArtifactValidationError(f"{path} must be a boolean")
    if expected_type == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
        raise ArtifactValidationError(f"{path} must be an integer")
    if expected_type == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        raise ArtifactValidationError(f"{path} must be a number")
    if expected_type == "null" and value is not None:
        raise ArtifactValidationError(f"{path} must be null")


def _validate_contract(artifact: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    schema_version = artifact.get("schema_version")
    if not isinstance(schema_version, str):
        raise ArtifactValidationError("artifact.schema_version is required and must be a string")
    contract_path = CONTRACTS.get(schema_version)
    if contract_path is None:
        raise ArtifactValidationError(f"unknown artifact schema_version: {schema_version}")
    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ArtifactValidationError(f"cannot read contract {contract_path}: {exc}") from exc
    if not isinstance(contract, dict):
        raise ArtifactValidationError(f"contract {contract_path} must be a JSON object")
    _validate_schema(artifact, contract, "artifact", contract)
    return schema_version, contract


def _resolve_commit(repository: Path, revision: str, label: str) -> str:
    if not SHA_RE.fullmatch(revision):
        raise ArtifactValidationError(f"{label} is not a valid Git revision")
    try:
        result = subprocess.run(
            ["git", "-C", str(repository), "rev-parse", "--verify", f"{revision}^{{commit}}"],
            capture_output=True,
            check=False,
            text=True,
        )
    except OSError as exc:
        raise ArtifactValidationError(f"cannot resolve {label} with local Git: {exc}") from exc
    resolved = result.stdout.strip()
    if result.returncode != 0 or not re.fullmatch(r"[0-9a-f]{40,64}", resolved):
        detail = result.stderr.strip() or "revision does not resolve to a commit"
        raise ArtifactValidationError(f"{label} cannot be resolved in {repository}: {detail}")
    return resolved


def validate_artifact(
    path: Path,
    expected_revision: str | None,
    repository: Path = ROOT,
) -> dict[str, str]:
    """Validate the artifact contract and its integrity, failing closed."""
    if not expected_revision:
        raise ArtifactValidationError(
            "expected Git revision context is required; refusing to validate artifact"
        )

    artifact = _load_artifact(path)
    schema_version, _ = _validate_contract(artifact)
    content_hash = artifact.get("content_hash")
    if not isinstance(content_hash, str) or not CONTENT_HASH_RE.fullmatch(content_hash):
        raise ArtifactValidationError("content_hash must match sha256:<64 lowercase hex characters>")
    computed_hash = "sha256:" + hashlib.sha256(canonicalize_artifact(artifact)).hexdigest()
    if content_hash != computed_hash:
        raise ArtifactValidationError(
            f"content_hash mismatch: declared {content_hash}, computed {computed_hash}"
        )

    baseline_sha = artifact.get("baseline_sha")
    if not isinstance(baseline_sha, str) or not SHA_RE.fullmatch(baseline_sha):
        raise ArtifactValidationError("baseline_sha must be a 40-64 character lowercase Git SHA")
    repository = repository.resolve()
    expected_resolved = _resolve_commit(repository, expected_revision, "expected revision")
    baseline_resolved = _resolve_commit(repository, baseline_sha, "baseline_sha")
    if baseline_resolved != expected_resolved:
        raise ArtifactValidationError(
            "baseline_sha does not resolve to the expected Git revision: "
            f"{baseline_resolved} != {expected_resolved}"
        )
    return {
        "schema_version": schema_version,
        "artifact_id": str(artifact.get("artifact_id", "")),
        "kind": str(artifact["kind"]),
        "role": str(artifact["role"]),
        "status": str(artifact["status"]),
        "baseline_sha": baseline_resolved,
        "content_hash": computed_hash,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument(
        "--expected-revision",
        help="the baseline revision recorded by do-work; omitted context fails closed",
    )
    parser.add_argument("--repository", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        result = validate_artifact(args.artifact, args.expected_revision, args.repository)
    except ArtifactValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "pass", **result}, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
