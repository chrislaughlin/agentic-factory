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
FIXTURE_BASELINE = "205f260e7565a04c3e29780bbc357ef274925329"


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
            "entry_points": [{"claim": "Planning scripts are local entry points.", "sources": ["scripts/"]}],
            "change_surface": [{"claim": "The validator is the relevant change surface.", "sources": ["scripts/validate_planning_artifact.py"]}],
            "dependencies": [{"claim": "The implementation uses the standard library.", "sources": ["scripts/"]}],
            "verification": [{"claim": "Focused tests verify the planning gate.", "sources": ["tests/test_issue19_planning.py"]}],
            "unknowns": [],
        },
        "unresolved_decisions": [],
        "acceptance_mapping": [{
            "id": "map-acceptance",
            "source": "Repository context is mapped",
            "targets": ["repository_map"],
        }],
        "verification_mapping": [{
            "id": "map-verification",
            "source": "map-acceptance",
            "targets": ["tests/test_issue19_planning.py"],
        }],
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
        "scope": {
            "in_scope": ["Validate technical blueprint content before approval"],
            "out_of_scope": ["Change verify-qa or watch-change responsibilities"],
        },
        "implementation": {
            "components": ["Planning artifact validator"],
            "interfaces": ["validate_artifact_document"],
            "data_and_state": ["No persisted data changes"],
            "failure_handling": ["Reject malformed or semantically empty final artifacts"],
        },
        "risk_controls": {
            "security": ["Keep final validation fail-closed"],
            "concurrency": ["No shared mutable state"],
            "performance": ["Use bounded standard-library validation"],
            "operability": ["Return deterministic gate output"],
        },
        "unresolved_decisions": [],
        "acceptance_mapping": [{
            "id": "acceptance-1",
            "source": "Final blueprint content is meaningful",
            "targets": ["scope", "implementation"],
        }],
        "verification_mapping": [{
            "id": "verification-1",
            "source": "acceptance-1",
            "targets": ["tests/test_issue19_planning.py"],
        }],
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
        validator = load_artifact_validator()
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "failure.json"
            fixture.write_text(json.dumps({
                "schema_version": "planning-eval.v1",
                "fixture_id": "negative-case",
                "expected_revision": FIXTURE_BASELINE,
                "recorded_result": {
                    "source": "sanitized",
                    "artifacts": [planning_artifact(validator, FIXTURE_BASELINE)],
                },
                "required_assertions": [{
                    "id": "missing",
                    "artifact_index": 0,
                    "path": "artifact_id",
                    "equals": "absent",
                }],
                "forbidden_matches": [{
                    "id": "forbidden",
                    "artifact_index": 0,
                    "path": "status",
                    "equals": "complete",
                }],
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
                    "expected_revision": FIXTURE_BASELINE,
                    "recorded_result": {"source": "sanitized"},
                    "required_assertions": [{"id": "r", "artifact_index": 0, "path": "status", "equals": "complete"}],
                    "forbidden_matches": [],
                }),
                "empty-capture.json": json.dumps({
                    "schema_version": "planning-eval.v1",
                    "fixture_id": "empty-capture",
                    "expected_revision": FIXTURE_BASELINE,
                    "recorded_result": {"source": "sanitized", "artifacts": []},
                    "required_assertions": [{"id": "r", "artifact_index": 0, "path": "status", "equals": "complete"}],
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

    def test_evaluator_blocks_malformed_hash_and_contract_invalid_artifacts(self):
        evaluator = load_evaluator()
        validator = load_artifact_validator()
        cases = {
            "malformed-hash": dict(
                planning_artifact(validator, FIXTURE_BASELINE),
                content_hash="sha256:not-a-valid-hash",
            ),
            "invalid-contract": dict(
                planning_artifact(validator, FIXTURE_BASELINE),
                role="design-solution",
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, artifact in cases.items():
                path = Path(directory) / f"{name}.json"
                path.write_text(json.dumps({
                    "schema_version": "planning-eval.v1",
                    "fixture_id": name,
                    "expected_revision": FIXTURE_BASELINE,
                    "recorded_result": {"source": "sanitized", "artifacts": [artifact]},
                    "required_assertions": [{
                        "id": "status",
                        "artifact_index": 0,
                        "path": "status",
                        "equals": "complete",
                    }],
                    "forbidden_matches": [],
                }))
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

    def test_validator_cli_keeps_gate_status_separate_from_artifact_status(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            path.write_text(json.dumps(blueprint_artifact(validator, baseline)), encoding="utf-8")
            output = subprocess.run(
                [
                    "python3", str(ROOT / "scripts" / "validate_planning_artifact.py"),
                    "--artifact", str(path), "--expected-revision", baseline,
                    "--repository", str(ROOT), "--stage", "approval",
                ],
                cwd=ROOT, text=True, capture_output=True, check=False,
            )

        self.assertEqual(output.returncode, 0, output.stderr)
        result = json.loads(output.stdout)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["gate_status"], "pass")
        self.assertEqual(result["artifact_status"], "complete")

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

    def test_verify_and_watch_responsibilities_remain_read_only_and_delegated(self):
        expected = {
            "verify-qa": "Validate every acceptance criterion against the tested revision with runtime evidence.",
            "watch-change": "Monitor CI and review feedback on the published PR or MR.",
        }
        for role, purpose in expected.items():
            with self.subTest(role=role):
                canonical = (ROOT / "agents" / f"{role}.md").read_text()
                codex = (ROOT / "adapters/codex" / f"{role}.toml").read_text()
                claude = (ROOT / "adapters/claude" / f"{role}.md").read_text()
                opencode = (ROOT / "adapters/opencode" / f"{role}.md").read_text()

                self.assertIn(purpose, canonical)
                self.assertIn(purpose, codex)
                self.assertIn(purpose, claude)
                self.assertIn(purpose, opencode)
                self.assertIn(f'"{role}": allow', opencode)
                self.assertIn("Do not spawn agents", canonical)
                self.assertIn("take ownership of the wider lifecycle", canonical.lower())

                self.assertIn('sandbox_mode = "read-only"', codex)
                self.assertIn("tools: [Read, Grep, Glob, Skill]", claude)
                self.assertIn("permissionMode: plan", claude)
                self.assertIn("disallowedTools: [Edit, Write, NotebookEdit]", claude)
                self.assertIn("edit: deny", opencode)
                self.assertRegex(opencode, r"(?m)^\s*bash\s*:\s*deny\s*$")

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

    def test_final_blueprint_gate_rejects_semantically_empty_core_content(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            empty = blueprint_artifact(validator, baseline)
            empty["scope"]["in_scope"] = []
            empty["implementation"]["components"] = []
            empty["acceptance_mapping"] = []
            empty["verification_mapping"] = []
            with_content_hash(validator, empty)
            path.write_text(json.dumps(empty), encoding="utf-8")

            for stage in ("final", "review", "approval"):
                with self.subTest(stage=stage):
                    with self.assertRaisesRegex(validator.ArtifactValidationError, "meaningful scope.in_scope"):
                        validator.validate_artifact(path, baseline, ROOT, stage=stage)

            empty["status"] = "draft"
            with_content_hash(validator, empty)
            path.write_text(json.dumps(empty), encoding="utf-8")
            advisory = validator.validate_artifact(path, baseline, ROOT, stage="advisory")
            self.assertEqual(advisory["status"], "draft")

    def test_final_blueprint_gate_requires_classification_specific_controls(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            blueprint = blueprint_artifact(validator, baseline)
            blueprint["change_classification"] = "performance"
            blueprint["risk_controls"]["performance"] = []
            with_content_hash(validator, blueprint)
            path.write_text(json.dumps(blueprint), encoding="utf-8")
            with self.assertRaisesRegex(validator.ArtifactValidationError, "risk_controls.performance"):
                validator.validate_artifact(path, baseline, ROOT, stage="approval")

            blueprint["risk_controls"]["performance"] = ["Keep local evaluation deterministic"]
            with_content_hash(validator, blueprint)
            path.write_text(json.dumps(blueprint), encoding="utf-8")
            result = validator.validate_artifact(path, baseline, ROOT, stage="approval")
            self.assertEqual(result["status"], "complete")

    def test_traceability_gate_rejects_unknown_and_orphaned_references(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        cases = {
            "unknown-acceptance-target": (
                lambda artifact: artifact["acceptance_mapping"][0]["targets"].__setitem__(
                    0, "implementation/missing-change"
                ),
                "unknown implementation/change ID or path",
            ),
            "unknown-verification-source": (
                lambda artifact: artifact["verification_mapping"][0].__setitem__(
                    "source", "acceptance-missing"
                ),
                "unknown acceptance/requirement ID",
            ),
            "unknown-verification-target": (
                lambda artifact: artifact["verification_mapping"][0]["targets"].__setitem__(
                    0, "tests/missing-verification.py"
                ),
                "unknown verification ID or evidence path",
            ),
            "duplicate-traceability-id": (
                lambda artifact: artifact["verification_mapping"][0].__setitem__(
                    "id", "acceptance-1"
                ),
                "IDs must be unique across the artifact",
            ),
            "orphaned-acceptance": (
                lambda artifact: artifact["acceptance_mapping"].append({
                    "id": "acceptance-orphan",
                    "source": "An unverified requirement",
                    "targets": ["implementation"],
                }),
                "orphaned acceptance/requirement IDs",
            ),
        }
        for name, (mutate, message) in cases.items():
            with self.subTest(name=name):
                artifact = blueprint_artifact(validator, baseline)
                mutate(artifact)
                with_content_hash(validator, artifact)
                with self.assertRaisesRegex(validator.ArtifactValidationError, message):
                    validator.validate_artifact_document(artifact, baseline, ROOT, stage="approval")

    def test_final_planning_result_requires_evidence_and_traceability(self):
        validator = load_artifact_validator()
        baseline = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True
        ).stdout.strip()
        cases = {
            "missing-repository-evidence": (
                lambda artifact: artifact["repository_map"].__setitem__("change_surface", []),
                "repository_map.change_surface evidence",
            ),
            "missing-acceptance-criteria": (
                lambda artifact: artifact.__setitem__("acceptance_mapping", []),
                "non-empty acceptance criteria mapping",
            ),
            "missing-verification-mapping": (
                lambda artifact: artifact.__setitem__("verification_mapping", []),
                "non-empty verification mapping",
            ),
            "missing-source-path": (
                lambda artifact: artifact["repository_map"]["verification"][0]["sources"].__setitem__(
                    0, "tests/missing-evidence.py"
                ),
                "existing evidence source path",
            ),
        }
        for name, (mutate, message) in cases.items():
            with self.subTest(name=name):
                artifact = planning_artifact(validator, baseline)
                mutate(artifact)
                with_content_hash(validator, artifact)
                with self.assertRaisesRegex(validator.ArtifactValidationError, message):
                    validator.validate_artifact_document(artifact, baseline, ROOT, stage="approval")

        draft = planning_artifact(validator, baseline)
        draft["status"] = "draft"
        draft["repository_map"]["entry_points"] = []
        draft["repository_map"]["change_surface"] = []
        draft["repository_map"]["dependencies"] = []
        draft["repository_map"]["verification"] = []
        draft["acceptance_mapping"] = []
        draft["verification_mapping"] = []
        with_content_hash(validator, draft)
        result = validator.validate_artifact_document(draft, baseline, ROOT, stage="advisory")
        self.assertEqual(result["status"], "draft")


if __name__ == "__main__":
    unittest.main()
