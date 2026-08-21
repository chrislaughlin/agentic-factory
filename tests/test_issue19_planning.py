from __future__ import annotations

import importlib.util
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
            elif metadata["permission"] == "workspace-write":
                self.assertIn('sandbox_mode = "workspace-write"', codex)
                self.assertIn("edit: allow", opencode)
            else:
                self.assertEqual(metadata["permission"], "tests-write")
                self.assertIn('sandbox_mode = "workspace-write"', codex)
                self.assertIn("tests and fixtures", canonical)
                self.assertIn("edit: allow", opencode)


if __name__ == "__main__":
    unittest.main()
