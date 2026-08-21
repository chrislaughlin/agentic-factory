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
ADVISORY_STAGE = "advisory"
FINAL_STAGES = frozenset({"final", "review", "approval"})
VALIDATION_STAGES = (ADVISORY_STAGE, "final", "review", "approval")
PLANNING_EVIDENCE_LISTS = (
    "entry_points",
    "change_surface",
    "dependencies",
    "verification",
)

# Final blueprints must describe a construction-ready change, not merely satisfy
# the shape of the JSON contract.  These paths are intentionally expressed in
# terms of the versioned contract so the check remains portable and local.
BLUEPRINT_CORE_LISTS = (
    "scope.in_scope",
    "implementation.components",
    "implementation.interfaces",
    "implementation.data_and_state",
    "implementation.failure_handling",
)
CLASSIFICATION_REQUIREMENTS = {
    "local": (),
    "multi-layer": ("risk_controls.operability",),
    "api": ("implementation.interfaces", "implementation.compatibility"),
    "shared-type": ("implementation.interfaces", "implementation.compatibility"),
    "schema": ("implementation.data_and_state", "risk_controls.rollback"),
    "migration": ("implementation.data_and_state", "risk_controls.rollback"),
    "auth": ("risk_controls.security",),
    "rollout": ("risk_controls.rollout",),
    "security": ("risk_controls.security",),
    "concurrency": ("risk_controls.concurrency",),
    "performance": ("risk_controls.performance",),
    "operability": ("risk_controls.operability",),
    "broad-impact-bug": (
        "risk_controls.security",
        "risk_controls.concurrency",
        "risk_controls.performance",
        "risk_controls.operability",
    ),
    "unknown": (
        "risk_controls.security",
        "risk_controls.concurrency",
        "risk_controls.performance",
        "risk_controls.operability",
    ),
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
    _validate_traceability(artifact, require_non_empty=False)
    return schema_version, contract


def _validate_stage(artifact: dict[str, Any], stage: str) -> None:
    if stage not in VALIDATION_STAGES:
        raise ArtifactValidationError(
            f"unsupported validation stage {stage!r}; expected one of {', '.join(VALIDATION_STAGES)}"
        )
    if stage == ADVISORY_STAGE:
        return
    if stage not in FINAL_STAGES:
        raise ArtifactValidationError(f"unsupported validation stage {stage!r}")

    if artifact["status"] != "complete":
        raise ArtifactValidationError(
            f"{stage} validation requires artifact.status to be 'complete'; "
            f"got {artifact['status']!r}"
        )

    unresolved = [
        decision["id"]
        for decision in artifact["unresolved_decisions"]
        if decision["status"] == "unresolved"
    ]
    if unresolved:
        raise ArtifactValidationError(
            "final validation requires no unresolved material decisions; "
            f"unresolved decision IDs: {', '.join(unresolved)}"
        )

    if artifact["schema_version"] == "planning-result.v1":
        _validate_final_planning_result(artifact)
    else:
        _validate_final_blueprint(artifact)
    _validate_traceability(artifact, require_non_empty=True)


def _non_empty_strings(value: Any) -> bool:
    return isinstance(value, list) and bool(
        value and all(isinstance(item, str) and item.strip() for item in value)
    )


def _artifact_path(artifact: dict[str, Any], dotted_path: str) -> Any:
    value: Any = artifact
    for part in dotted_path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _require_meaningful_list(artifact: dict[str, Any], dotted_path: str) -> None:
    if not _non_empty_strings(_artifact_path(artifact, dotted_path)):
        raise ArtifactValidationError(
            f"final technical blueprint requires meaningful {dotted_path} content"
        )


def _mapping_ids(mappings: Any, dotted_path: str) -> dict[str, int]:
    if not isinstance(mappings, list):
        raise ArtifactValidationError(f"{dotted_path} must be a list")
    ids: dict[str, int] = {}
    for index, mapping in enumerate(mappings):
        mapping_id = mapping.get("id") if isinstance(mapping, dict) else None
        if not isinstance(mapping_id, str) or not mapping_id.strip():
            raise ArtifactValidationError(
                f"{dotted_path}[{index}].id must be a meaningful identifier"
            )
        if mapping_id in ids:
            raise ArtifactValidationError(
                f"{dotted_path} contains duplicate mapping ID {mapping_id!r}"
            )
        ids[mapping_id] = index
    return ids


def _repository_path_exists(reference: str) -> bool:
    """Resolve a repository-relative evidence path without escaping the root."""
    if not isinstance(reference, str) or not reference.strip():
        return False
    reference = reference.strip()
    candidate = (ROOT / reference).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return False
    return candidate.exists()


def _declared_string_exists(value: Any, reference: str) -> bool:
    """Check compact string-list identifiers without matching arbitrary prose."""
    def contains(value: Any) -> bool:
        if isinstance(value, list):
            return reference in value or any(contains(item) for item in value)
        if isinstance(value, dict):
            return any(contains(item) for item in value.values())
        return False
    return contains(value)


def _change_reference_exists(artifact: dict[str, Any], reference: str) -> bool:
    """Resolve an implementation/change section or declared implementation ID."""
    if not isinstance(reference, str) or not reference.strip():
        return False
    reference = reference.strip()
    root = "repository_map" if artifact.get("schema_version") == "planning-result.v1" else "implementation"
    if reference == root or reference.startswith(root + "."):
        return True
    if artifact.get("schema_version") == "technical-blueprint.v1":
        if reference in {"scope", "risk_controls"}:
            return True
        if reference.startswith(("scope.", "risk_controls.")):
            return _artifact_path(artifact, reference) is not None
    return _declared_string_exists(artifact.get("implementation"), reference)


def _verification_reference_exists(artifact: dict[str, Any], reference: str) -> bool:
    """Resolve a verification evidence path or repository-map verification path."""
    if _repository_path_exists(reference):
        return True
    if not isinstance(reference, str) or not reference.strip():
        return False
    reference = reference.strip()
    return artifact.get("schema_version") == "planning-result.v1" and (
        reference == "repository_map.verification"
        or reference.startswith("repository_map.verification.")
    )

def _validate_traceability(artifact: dict[str, Any], require_non_empty: bool) -> None:
    acceptance = artifact.get("acceptance_mapping")
    verification = artifact.get("verification_mapping")
    acceptance_ids = _mapping_ids(acceptance, "artifact.acceptance_mapping")
    verification_ids = _mapping_ids(verification, "artifact.verification_mapping")

    if require_non_empty and not acceptance_ids:
        raise ArtifactValidationError(
            "final artifact requires non-empty acceptance criteria mapping"
        )
    if require_non_empty and not verification_ids:
        raise ArtifactValidationError(
            "final artifact requires non-empty verification mapping"
        )
    if not require_non_empty and (not acceptance_ids or not verification_ids):
        return

    all_ids = set(acceptance_ids) | set(verification_ids)
    if len(all_ids) != len(acceptance_ids) + len(verification_ids):
        raise ArtifactValidationError(
            "acceptance_mapping and verification_mapping IDs must be unique across the artifact"
        )

    implementation_root = (
        "repository_map"
        if artifact.get("schema_version") == "planning-result.v1"
        else "implementation"
    )
    covered_implementation = False
    for index, mapping in enumerate(acceptance or []):
        source = mapping["source"].strip()
        if not source:
            raise ArtifactValidationError(
                f"artifact.acceptance_mapping[{index}].source must be meaningful"
            )
        targets = mapping["targets"]
        for target in targets:
            if not _change_reference_exists(artifact, target):
                raise ArtifactValidationError(
                    f"artifact.acceptance_mapping[{index}].targets references unknown "
                    f"implementation/change ID or path {target!r}"
                )
            if target == implementation_root or target.startswith(implementation_root + "."):
                covered_implementation = True

    verified_acceptance = set()
    for index, mapping in enumerate(verification or []):
        source = mapping["source"].strip()
        if source not in acceptance_ids:
            raise ArtifactValidationError(
                f"artifact.verification_mapping[{index}].source references unknown "
                f"acceptance/requirement ID {source!r}"
            )
        verified_acceptance.add(source)
        for target in mapping["targets"]:
            if not _verification_reference_exists(artifact, target):
                raise ArtifactValidationError(
                    f"artifact.verification_mapping[{index}].targets references unknown "
                    f"verification ID or evidence path {target!r}"
                )

    orphaned = sorted(set(acceptance_ids) - verified_acceptance)
    if orphaned:
        raise ArtifactValidationError(
            "orphaned acceptance/requirement IDs lack verification mappings: "
            + ", ".join(orphaned)
        )
    if require_non_empty and not covered_implementation:
        raise ArtifactValidationError(
            f"acceptance mappings must cover the declared {implementation_root} change surface"
        )


def _validate_final_planning_result(artifact: dict[str, Any]) -> None:
    repository_map = artifact["repository_map"]
    for key in PLANNING_EVIDENCE_LISTS:
        evidence = repository_map[key]
        if not isinstance(evidence, list) or not evidence:
            raise ArtifactValidationError(
                f"final planning result requires meaningful repository_map.{key} evidence"
            )
        for index, item in enumerate(evidence):
            if not item["claim"].strip() or not item["sources"]:
                raise ArtifactValidationError(
                    f"final planning result requires meaningful repository_map.{key}[{index}] evidence"
                )
            for source in item["sources"]:
                if not source.strip() or not _repository_path_exists(source):
                    raise ArtifactValidationError(
                        f"final planning result requires an existing evidence source path; "
                        f"got {source!r} in repository_map.{key}[{index}]"
                    )


def _validate_final_blueprint(artifact: dict[str, Any]) -> None:
    for dotted_path in BLUEPRINT_CORE_LISTS:
        _require_meaningful_list(artifact, dotted_path)

    for dotted_path in ("acceptance_mapping", "verification_mapping"):
        mappings = _artifact_path(artifact, dotted_path)
        if not isinstance(mappings, list) or not mappings:
            raise ArtifactValidationError(
                f"final technical blueprint requires {dotted_path} traceability"
            )

    classification = artifact["change_classification"]
    for dotted_path in CLASSIFICATION_REQUIREMENTS[classification]:
        _require_meaningful_list(artifact, dotted_path)


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
    stage: str = "approval",
) -> dict[str, str]:
    """Validate an artifact file, failing closed for final review and approval stages."""
    return validate_artifact_document(
        _load_artifact(path), expected_revision, repository, stage=stage
    )


def validate_artifact_document(
    artifact: dict[str, Any],
    expected_revision: str | None,
    repository: Path = ROOT,
    stage: str = "approval",
) -> dict[str, str]:
    """Validate an in-memory artifact using the same gate as artifact files."""
    if not expected_revision:
        raise ArtifactValidationError(
            "expected Git revision context is required; refusing to validate artifact"
        )

    if not isinstance(artifact, dict):
        raise ArtifactValidationError("artifact must be a JSON object")
    schema_version, _ = _validate_contract(artifact)
    _validate_stage(artifact, stage)
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
        "stage": stage,
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
    parser.add_argument(
        "--stage",
        choices=VALIDATION_STAGES,
        default="approval",
        help="validation stage; advisory permits draft artifacts, final stages require completion",
    )
    args = parser.parse_args(argv)
    try:
        result = validate_artifact(
            args.artifact,
            args.expected_revision,
            args.repository,
            stage=args.stage,
        )
    except ArtifactValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        gate_status = (
            "blocked"
            if str(exc) == "expected Git revision context is required; refusing to validate artifact"
            else "fail"
        )
        print(json.dumps({
            "status": gate_status,
            "gate_status": gate_status,
            "artifact_status": None,
            "error": str(exc),
        }, sort_keys=True, separators=(",", ":")))
        return 1
    output = {
        "status": "pass",
        "gate_status": "pass",
        "artifact_status": result["status"],
        **{key: value for key, value in result.items() if key != "status"},
    }
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
