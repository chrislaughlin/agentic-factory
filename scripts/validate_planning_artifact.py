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
    """Validate content_hash and baseline_sha, failing closed without context."""
    if not expected_revision:
        raise ArtifactValidationError(
            "expected Git revision context is required; refusing to validate artifact"
        )

    artifact = _load_artifact(path)
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
        "artifact_id": str(artifact.get("artifact_id", "")),
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
