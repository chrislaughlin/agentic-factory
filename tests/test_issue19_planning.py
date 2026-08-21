from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVALUATOR = ROOT / "scripts" / "evaluate_planning.py"


def load_evaluator():
    spec = importlib.util.spec_from_file_location("planning_evaluator", EVALUATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_artifact_validator():
    path = ROOT / "scripts" / "validate_planning_artifact.py"
    spec = importlib.util.spec_from_file_location("planning_artifact_validator", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def with_content_hash(validator, artifact):
    artifact["content_hash"] = "sha256:" + hashlib.sha256(
        validator.canonicalize_artifact(artifact)
    ).hexdigest()
    return artifact


def planning_artifact(validator, baseline):
    return with_content_hash(validator, {
        "schema_version": "planning-result.v1",
        "kind": "planning-result",
        "role": "map-codebase",
        "artifact_id": "map-001",
        "baseline_sha": baseline,
        "content_hash": "",
        "status": "complete",
        "summary": "A valid planning artifact.",
        "repository_map": {
            "entry_points": [],
            "change_surface": [],
            "dependencies": [],
            "verification": [],
            "unknowns": [],
        },
        "unresolved_decisions": [],
        "acceptance_mapping": [],
        "verification_mapping": [],
    })


def blueprint_artifact(validator, baseline):
    return with_content_hash(validator, {
        "schema_version": "technical-blueprint.v1",
        "kind": "technical-blueprint",
        "role": "design-solution",
        "artifact_id": "blueprint-001",
        "baseline_sha": baseline,
        "content_hash": "",
        "status": "complete",
        "change_classification": "security",
        "scope": {"in_scope": [], "out_of_scope": []},
        "implementation": {
            "components": [],
            "interfaces": [],
            "data_and_state": [],
            "failure_handling": [],
        },
        "risk_controls": {
            "security": [],
            "concurrency": [],
            "performance": [],
            "operability": [],
        },
        "unresolved_decisions": [],
        "acceptance_mapping": [],
        "verification_mapping": [],
    })


class Issue19PlanningTests(unittest.TestCase):
    def test_planning_lifecycle_stops_ambiguity_and_preserves_human_gates(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        planning = (ROOT / ".agents/skills/do-work/references/planning.md").read_text()
        workflow = (ROOT / ".agents/skills/do-work/references/workflow.md").read_text()

        self.assertIn("Ask exactly one material decision at a time", do_work)
        self.assertIn("Stop when the decision is resolved or explicitly unresolved", planning)
        self.assertIn("never silently choose a consequential behavior", planning)
        self.assertIn("wait for explicit approval", do_work.lower())
        self.assertIn("Never merge or deploy", workflow)
        self.assertIn("Treat `blocked` as a stop, not a pass", workflow)

        first_follow_up = planning.index("Follow-up")
        second_follow_up = planning.index("Follow-up", first_follow_up + 1)
        stages = [
            "Initial questions", "Repository discovery", "Mapping", first_follow_up,
            "Design", second_follow_up, "Conditional review", "Reconciliation",
            "Exact final artifact review", "Explicit approval", "Construction",
        ]
        positions = [stage if isinstance(stage, int) else planning.index(stage) for stage in stages]
        self.assertEqual(positions, sorted(positions))

    def test_review_activation_covers_broad_impact_unknown_and_exact_artifact_integrity(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        review = (ROOT / ".agents/skills/review-technical-plan/SKILL.md").read_text()
        blueprint_contract = (
            ROOT / ".agents/skills/do-work/references/contracts/technical-blueprint-v1.md"
        ).read_text()

        for trigger in (
            "multi-layer", "API", "shared-type", "schema", "migration", "auth",
            "rollout", "security", "concurrency", "performance", "operability",
            "broad-impact bug fixes", "unknown classification",
        ):
            self.assertIn(trigger, do_work)
        self.assertIn("exact final reconciled blueprint", review)
        self.assertIn("baseline SHA and canonical content hash", review)
        self.assertIn("hash mismatch", review)
        self.assertIn("review the new exact artifact", blueprint_contract)
        self.assertIn("malformed artifact", (ROOT / ".agents/skills/do-work/references/planning.md").read_text())

    def test_evaluator_reports_required_and_forbidden_failures(self):
        evaluator = load_evaluator()
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "failure.json"
            fixture.write_text(json.dumps({
                "schema_version": "planning-eval.v1",
                "fixture_id": "negative-case",
                "recorded_result": {"source": "sanitized", "text": "present forbidden"},
                "required_assertions": [{"id": "missing", "match": "absent"}],
                "forbidden_matches": [{"id": "forbidden", "match": "forbidden"}],
            }))
            code, result = evaluator.run(fixture)

        self.assertEqual(code, evaluator.EXIT_ASSERTION_FAILURE)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["required_matched"], 0)
        self.assertEqual(result["required_assertions"], 1)
        self.assertEqual(result["forbidden_matches"], 1)

    def test_evaluator_blocks_missing_malformed_and_invalid_capture_inputs(self):
        evaluator = load_evaluator()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases = {
                "malformed.json": "{not-json",
                "missing-capture.json": json.dumps({
                    "schema_version": "planning-eval.v1",
                    "fixture_id": "missing-capture",
                    "recorded_result": {"source": "sanitized"},
                    "required_assertions": [{"id": "r", "match": "r"}],
                    "forbidden_matches": [],
                }),
                "empty-capture.json": json.dumps({
                    "schema_version": "planning-eval.v1",
                    "fixture_id": "empty-capture",
                    "recorded_result": {"source": "sanitized", "text": ""},
                    "required_assertions": [{"id": "r", "match": "r"}],
                    "forbidden_matches": [],
                }),
            }
            for name, content in cases.items():
                path = root / name
                path.write_text(content)
                with self.subTest(name=name):
                    code, result = evaluator.run(path)
                    self.assertEqual(code, evaluator.EXIT_BLOCKED)
                    self.assertEqual(result["status"], "blocked")

    def test_evaluator_is_portable_and_deterministic_for_fixture_file_and_directory(self):
        fixture = ROOT / "tests/fixtures/planning-evals/planning-loop.v1.json"
        with tempfile.TemporaryDirectory() as directory:
            output_one = subprocess.run(
                ["python3", str(EVALUATOR), "--fixtures", str(fixture)],
                cwd=directory, text=True, capture_output=True, check=False,
            )
            output_two = subprocess.run(
                ["python3", str(EVALUATOR), "--fixtures", str(fixture)],
                cwd=directory, text=True, capture_output=True, check=False,
            )
        self.assertEqual(output_one.returncode, 0, output_one.stderr)
        self.assertEqual(output_one.stdout, output_two.stdout)
        self.assertEqual(json.loads(output_one.stdout)["status"], "pass")

    def test_role_parity_and_permission_intent_are_preserved_across_harnesses(self):
        manifest = json.loads((ROOT / "agents/manifest.json").read_text())
        roles = manifest["roles"]
        adapter_sets = {
            "canonical": {p.stem for p in (ROOT / "agents").glob("*.md")},
            "codex": {p.stem for p in (ROOT / "adapters/codex").glob("*.toml")},
            "claude": {p.stem for p in (ROOT / "adapters/claude").glob("*.md")},
            "opencode": {p.stem for p in (ROOT / "adapters/opencode").glob("*.md")},
        }
        for harness, names in adapter_sets.items():
            with self.subTest(harness=harness):
                self.assertEqual(names, set(roles))

        for role, metadata in roles.items():
            canonical = (ROOT / "agents" / f"{role}.md").read_text()
            self.assertIn(f"Permission intent: `{metadata['permission']}`", canonical)
            codex = (ROOT / "adapters/codex" / f"{role}.toml").read_text()
            claude = (ROOT / "adapters/claude" / f"{role}.md").read_text()
            opencode = (ROOT / "adapters/opencode" / f"{role}.md").read_text()
            if metadata["permission"] == "read-only":
                self.assertIn('sandbox_mode = "read-only"', codex)
                self.assertIn("disallowedTools: [Edit, Write, NotebookEdit]", claude)
                self.assertIn("edit: deny", opencode)
                self.assertRegex(opencode, r"(?m)^\s*bash\s*:\s*deny\s*$")
            elif metadata["permission"] == "workspace-write":
                self.assertIn('sandbox_mode = "workspace-write"', codex)
                self.assertIn("edit: allow", opencode)
            else:
                self.assertEqual(metadata["permission"], "tests-write")
                self.assertIn('sandbox_mode = "workspace-write"', codex)
                self.assertIn("tests and fixtures", canonical)
                self.assertIn("edit: allow", opencode)

    def test_planning_artifact_gate_rejects_tampering_and_missing_revision_context(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        artifact = planning_artifact(validator, baseline)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            path.write_text(json.dumps(artifact), encoding="utf-8")
            valid = validator.validate_artifact(path, baseline, ROOT)
            self.assertEqual(valid["baseline_sha"], baseline)

            tampered = dict(artifact, summary="Tampered after approval")
            path.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "content_hash mismatch"):
                validator.validate_artifact(path, baseline, ROOT)

            path.write_text(json.dumps(artifact), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "expected Git revision context"):
                validator.validate_artifact(path, None, ROOT)

            missing_revision = dict(artifact)
            missing_revision.pop("baseline_sha")
            with_content_hash(validator, missing_revision)
            path.write_text(json.dumps(missing_revision), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "baseline_sha"):
                validator.validate_artifact(path, baseline, ROOT)

    def test_planning_artifact_gate_rejects_minimal_and_unknown_contract_artifacts(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            minimal = with_content_hash(validator, {
                "baseline_sha": baseline,
                "content_hash": "",
            })
            path.write_text(json.dumps(minimal), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "schema_version"):
                validator.validate_artifact(path, baseline, ROOT)

            unknown_kind = planning_artifact(validator, baseline)
            unknown_kind["kind"] = "untrusted-kind"
            with_content_hash(validator, unknown_kind)
            path.write_text(json.dumps(unknown_kind), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "must equal"):
                validator.validate_artifact(path, baseline, ROOT)

            malformed_mapping = planning_artifact(validator, baseline)
            malformed_mapping["acceptance_mapping"] = {"id": "not-a-list"}
            with_content_hash(validator, malformed_mapping)
            path.write_text(json.dumps(malformed_mapping), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "acceptance_mapping"):
                validator.validate_artifact(path, baseline, ROOT)

            missing_unknowns = planning_artifact(validator, baseline)
            missing_unknowns["repository_map"].pop("unknowns")
            with_content_hash(validator, missing_unknowns)
            path.write_text(json.dumps(missing_unknowns), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "unknowns"):
                validator.validate_artifact(path, baseline, ROOT)

    def test_planning_artifact_gate_accepts_valid_result_and_blueprint(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            for artifact, kind, role in (
                (planning_artifact(validator, baseline), "planning-result", "map-codebase"),
                (blueprint_artifact(validator, baseline), "technical-blueprint", "design-solution"),
            ):
                path.write_text(json.dumps(artifact), encoding="utf-8")
                result = validator.validate_artifact(path, baseline, ROOT)
                self.assertEqual(result["kind"], kind)
                self.assertEqual(result["role"], role)
                self.assertEqual(result["status"], "complete")

    def test_planning_artifact_gate_rejects_invalid_or_mismatched_revision(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        artifact = blueprint_artifact(validator, baseline)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            path.write_text(json.dumps(artifact), encoding="utf-8")
            invalid_revision = dict(artifact, baseline_sha="0" * 40)
            with_content_hash(validator, invalid_revision)
            path.write_text(json.dumps(invalid_revision), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "cannot be resolved"):
                validator.validate_artifact(path, baseline, ROOT)

            other_revision = subprocess.run(
                ["git", "rev-parse", "HEAD^"], cwd=ROOT, text=True, capture_output=True, check=True
            ).stdout.strip()
            mismatched = with_content_hash(validator, dict(artifact, baseline_sha=other_revision))
            path.write_text(json.dumps(mismatched), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "does not resolve to the expected"):
                validator.validate_artifact(path, baseline, ROOT)

    def test_planning_artifact_gate_requires_complete_decision_free_final_artifacts(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            draft = blueprint_artifact(validator, baseline)
            draft["status"] = "draft"
            draft["unresolved_decisions"] = [{
                "id": "decision-1",
                "question": "Which behavior is required?",
                "status": "unresolved",
            }]
            with_content_hash(validator, draft)
            path.write_text(json.dumps(draft), encoding="utf-8")

            for stage in ("final", "review", "approval"):
                with self.subTest(stage=stage):
                    with self.assertRaisesRegex(validator.ArtifactValidationError, "status.*complete"):
                        validator.validate_artifact(path, baseline, ROOT, stage=stage)

            advisory = validator.validate_artifact(path, baseline, ROOT, stage="advisory")
            self.assertEqual(advisory["status"], "draft")
            self.assertEqual(advisory["stage"], "advisory")

            draft["status"] = "complete"
            with_content_hash(validator, draft)
            path.write_text(json.dumps(draft), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "unresolved material decisions"):
                validator.validate_artifact(path, baseline, ROOT, stage="approval")


if __name__ == "__main__":
    unittest.main()
