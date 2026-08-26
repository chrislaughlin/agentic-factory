from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVALS = ROOT / "evals"
NODE = EVALS / "node_modules" / ".bin" / "tsc"


def run_node(
    source: str, *, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )


class Issue21EvalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        result = subprocess.run(
            ["npm", "run", "eval"], cwd=ROOT, text=True, capture_output=True, check=False
        )
        if result.returncode:
            raise unittest.SkipTest(f"eval package is not installed: {result.stderr}")

    def test_runner_enforces_manifest_parity_and_orchestration_coverage(self):
        result = subprocess.run(
            ["npm", "run", "eval"], cwd=ROOT, text=True, capture_output=True, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((ROOT / "agents/manifest.json").read_text())
        cases = json.loads((EVALS / "cases/cases.json").read_text())
        self.assertEqual(
            {case["role"] for case in cases},
            set(manifest["roles"]) | {"shape-work", "do-work"},
        )
        self.assertIn("shape-work/shape-vague-request PASS", result.stdout)
        self.assertIn("do-work/do-work-ambiguity PASS", result.stdout)
        self.assertIn("Roles: 13/13 covered; cases: 15 passed, 0 failed.", result.stdout)

    def test_required_forbidden_scoring_and_metrics_are_deterministic(self):
        script = """
            import { scoreOutput } from './evals/dist/assertions/output.js';
            const testCase = {
              required: ['required-a', 'required-b'],
              forbidden: ['forbidden-a'],
              observed: ['required-a', 'forbidden-a', 'unrelated'],
            };
            console.log(JSON.stringify(scoreOutput(testCase)));
        """
        first = run_node(script)
        second = run_node(script)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(
            json.loads(first.stdout),
            {
                "recall": 0.5,
                "falsePositiveRate": 1 / 3,
                "failures": [
                    "missed required outcomes: required-b",
                    "forbidden outcomes observed: forbidden-a",
                ],
            },
        )

    def test_declared_output_assertions_add_to_fixture_constraints_for_scoring(self):
        script = """
            import { scoreOutput } from './evals/dist/assertions/output.js';
            const testCase = {
              required: ['legacy-required'],
              forbidden: ['legacy-forbidden'],
              observed: ['declared-required', 'legacy-forbidden', 'declared-forbidden'],
              assertions: [{
                type: 'output',
                required: ['declared-required'],
                forbidden: ['declared-forbidden'],
              }],
            };
            console.log(JSON.stringify(scoreOutput(testCase)));
        """
        result = run_node(script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "recall": 0.5,
                "falsePositiveRate": 2 / 3,
                "failures": [
                    "missed required outcomes: legacy-required",
                    "forbidden outcomes observed: legacy-forbidden, declared-forbidden",
                ],
            },
        )

    def test_live_response_cannot_erase_fixture_forbidden_expectations(self):
        fixture = {
            "id": "immutable-forbidden",
            "role": "author-tests",
            "scenario": "live response omits immutable fields",
            "required": [],
            "forbidden": ["fixture-forbidden"],
            "observed": [],
            "assertions": [],
            "state": {},
        }
        response = {"observed": ["fixture-forbidden"], "state": {}}
        with tempfile.TemporaryDirectory() as directory:
            launcher = Path(directory) / "live-launcher"
            launcher.write_text("#!/bin/sh\nprintf '%s\\n' '" + json.dumps(response) + "'\n")
            launcher.chmod(0o755)
            script = f"""
                import {{ runCodex }} from './evals/dist/harnesses/codex.js';
                import {{ scoreOutput }} from './evals/dist/assertions/output.js';
                const result = await runCodex({json.dumps(fixture)});
                console.log(JSON.stringify(scoreOutput(result)));
            """
            env = os.environ | {"CODEX_EVAL_COMMAND": str(launcher)}
            result = run_node(script, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "recall": 1,
                "falsePositiveRate": 1,
                "failures": ["forbidden outcomes observed: fixture-forbidden"],
            },
        )

    def test_live_response_cannot_rewrite_fixture_forbidden_expectations(self):
        fixture = {
            "id": "immutable-forbidden-rewrite",
            "role": "author-tests",
            "scenario": "live response rewrites immutable field",
            "required": [],
            "forbidden": ["fixture-forbidden"],
            "observed": [],
            "assertions": [],
            "state": {},
        }
        response = {
            "forbidden": ["rewritten-forbidden"],
            "observed": [],
            "state": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            launcher = Path(directory) / "live-launcher"
            launcher.write_text("#!/bin/sh\nprintf '%s\\n' '" + json.dumps(response) + "'\n")
            launcher.chmod(0o755)
            script = f"""
                import {{ runCodex }} from './evals/dist/harnesses/codex.js';
                await runCodex({json.dumps(fixture)});
            """
            env = os.environ | {"CODEX_EVAL_COMMAND": str(launcher)}
            result = run_node(script, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "immutable field forbidden differs from fixture immutable-forbidden-rewrite",
            result.stderr,
        )

    def test_live_launcher_receives_only_scenario_fields_without_answer_key(self):
        fixture = {
            "id": "safe-live-input",
            "role": "author-tests",
            "scenario": "launcher must not receive scoring data",
            "required": ["required-answer"],
            "forbidden": ["forbidden-answer"],
            "observed": [],
            "assertions": [{"type": "output", "required": ["required-answer"]}],
            "state": {"changedPaths": ["tests/expected.py"], "headAdvanced": True},
        }
        with tempfile.TemporaryDirectory() as directory:
            launcher = Path(directory) / "live-launcher"
            received = Path(directory) / "received.json"
            launcher.write_text(
                "#!/bin/sh\n"
                "printf '%s' \"$1\" > \"" + str(received) + "\"\n"
                "printf '%s\\n' '{\"observed\":[\"required-answer\"],\"state\":{}}'\n"
            )
            launcher.chmod(0o755)
            script = f"""
                import {{ runCodex }} from './evals/dist/harnesses/codex.js';
                await runCodex({json.dumps(fixture)});
            """
            env = os.environ | {"CODEX_EVAL_COMMAND": str(launcher)}
            result = run_node(script, env=env)
            received_input = json.loads(received.read_text())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            received_input,
            {"id": fixture["id"], "role": fixture["role"], "scenario": fixture["scenario"]},
        )
        self.assertNotIn("required", received_input)
        self.assertNotIn("forbidden", received_input)
        self.assertNotIn("assertions", received_input)
        self.assertNotIn("state", received_input)

    def test_live_response_state_payload_rejects_unknown_keys(self):
        fixture = {
            "id": "invalid-live-state",
            "role": "author-tests",
            "scenario": "live response contains an answer key in state",
            "required": [],
            "forbidden": [],
            "observed": [],
            "assertions": [],
            "state": {},
        }
        response = {"observed": [], "state": {"answerKey": ["secret"]}}
        with tempfile.TemporaryDirectory() as directory:
            launcher = Path(directory) / "live-launcher"
            launcher.write_text("#!/bin/sh\nprintf '%s\\n' '" + json.dumps(response) + "'\n")
            launcher.chmod(0o755)
            script = f"""
                import {{ runCodex }} from './evals/dist/harnesses/codex.js';
                await runCodex({json.dumps(fixture)});
            """
            env = os.environ | {"CODEX_EVAL_COMMAND": str(launcher)}
            result = run_node(script, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("state contains invalid observed filesystem/Git state", result.stderr)

    def test_eval_command_does_not_add_untracked_generated_artifacts(self):
        before = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        ).stdout
        result = subprocess.run(
            ["npm", "run", "eval"], cwd=ROOT, text=True, capture_output=True, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        after = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        ).stdout
        self.assertEqual(after, before)

    def test_filesystem_and_git_assertions_report_scope_and_checkpoint_failures(self):
        script = """
            import { checkFilesystem } from './evals/dist/assertions/filesystem.js';
            import { checkGit } from './evals/dist/assertions/git.js';
            const testCase = {
              assertions: [
                { type: 'filesystem', changed: ['tests/added.py'], forbiddenChanged: ['src/production.py'] },
                { type: 'git', headAdvanced: true, nonEmptyCheckpoint: true, changedPathsWithinScope: true },
              ],
              state: { changedPaths: ['src/production.py'], headAdvanced: false, nonEmptyCheckpoint: false, changedPathsWithinScope: false },
            };
            console.log(JSON.stringify([...checkFilesystem(testCase), ...checkGit(testCase)]));
        """
        result = run_node(script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            [
                "missing changed path: tests/added.py",
                "forbidden changed path: src/production.py",
                "unexpected Git HEAD advancement",
                "unexpected checkpoint diff state",
                "changed paths are outside the approved scope",
            ],
        )

    def test_invalid_fixture_handling_fails_closed_in_isolated_runner_copy(self):
        invalid_cases = json.loads(
            (ROOT / "tests/fixtures/eval-runner/invalid-cases.json").read_text()
        )
        for invalid in invalid_cases:
            with self.subTest(case=invalid["name"]), tempfile.TemporaryDirectory() as directory:
                sandbox = Path(directory)
                eval_copy = sandbox / "evals"
                shutil.copytree(EVALS, eval_copy, ignore=shutil.ignore_patterns("dist", "node_modules"))
                (eval_copy / "node_modules").symlink_to(EVALS / "node_modules", target_is_directory=True)
                (sandbox / "agents").mkdir()
                shutil.copy(ROOT / "agents/manifest.json", sandbox / "agents/manifest.json")
                (eval_copy / "cases/cases.json").write_text(json.dumps(invalid["content"]))
                compile_result = subprocess.run(
                    [str(NODE), "-p", str(eval_copy / "tsconfig.json")],
                    cwd=sandbox,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(compile_result.returncode, 0, compile_result.stderr)
                result = subprocess.run(
                    ["node", str(eval_copy / "dist/runner.js")],
                    cwd=sandbox,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ERROR:", result.stderr)


class Issue21InstallerIsolationTests(unittest.TestCase):
    def test_single_harness_install_does_not_escape_destination_or_modify_source(self):
        installer = ROOT / "scripts/install.sh"
        source_before = {
            path.relative_to(ROOT): path.read_bytes()
            for path in (ROOT / "agents").glob("*.md")
        }
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            result = subprocess.run(
                ["sh", str(installer), "--dest-home", str(home), "--harness", "codex"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((home / ".codex/agents/author-tests.toml").is_file())
            self.assertFalse((home / ".claude").exists())
            self.assertFalse((home / ".config/opencode").exists())
            self.assertEqual(
                {path.relative_to(ROOT): path.read_bytes() for path in (ROOT / "agents").glob("*.md")},
                source_before,
            )


if __name__ == "__main__":
    unittest.main()
