from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_validator():
    spec = importlib.util.spec_from_file_location("agent_factory_validate", ROOT / "scripts" / "validate.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StaticContractTests(unittest.TestCase):
    def test_repository_contracts_validate(self):
        self.assertEqual(load_validator().validate(), [])

    def test_orchestrator_contains_required_gates(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        workflow = (ROOT / ".agents/skills/do-work/references/workflow.md").read_text()
        self.assertIn("Ask exactly one material decision at a time", do_work)
        self.assertIn("explicit approval", do_work)
        self.assertIn("run `review-security` against that immutable commit and `author-tests`", do_work)
        self.assertIn("Permit three full remediation cycles", do_work)
        self.assertIn("Never merge or deploy", workflow)

    def test_each_work_item_uses_an_isolated_git_worktree(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        workflow = (ROOT / ".agents/skills/do-work/references/workflow.md").read_text()
        identity = (ROOT / ".agents/skills/do-work/references/worktree.md").read_text()
        journal = (ROOT / ".agents/skills/do-work/references/journal.md").read_text()
        construction = (ROOT / ".agents/skills/construct-work/references/contract.md").read_text()
        tests = (ROOT / ".agents/skills/author-tests/references/contract.md").read_text()
        self.assertIn("git worktree add", do_work)
        self.assertIn("outside every existing worktree", workflow)
        self.assertIn("Every approved work item has one identity", identity)
        self.assertIn("<absolute-git-common-directory>/agent-factory/work", journal)
        self.assertIn("Worktree: <absolute path>", journal)
        self.assertIn("delegated worktree", construction)
        self.assertIn("delegated worktree", tests)

    def test_new_worktree_copies_local_environment_files_safely(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        worktree = (ROOT / ".agents/skills/do-work/references/worktree.md").read_text()
        journal = (ROOT / ".agents/skills/do-work/references/journal.md").read_text()
        construction = (ROOT / ".agents/skills/construct-work/references/contract.md").read_text()
        tests = (ROOT / ".agents/skills/author-tests/references/contract.md").read_text()
        self.assertIn("ls-files --others --ignored --exclude-standard -z", worktree)
        self.assertIn("`.env` and `.env.*`", worktree)
        self.assertIn("regular files", worktree)
        self.assertIn("Never print", worktree)
        self.assertIn("differs from the recorded baseline", worktree)
        self.assertIn("reject any existing symlink", worktree)
        self.assertIn("Control checkout: <absolute path>", journal)
        self.assertIn("Environment bootstrap", journal)
        self.assertIn("Before every checkpoint commit and push", worktree)
        self.assertIn("before staging or committing", construction)
        self.assertIn("before staging or committing", tests)
        self.assertIn("before every later push", do_work)
        self.assertIn("before delegating", do_work)

    def test_specialist_boundaries_are_explicit(self):
        construction = (ROOT / ".agents/skills/construct-work/references/contract.md").read_text()
        tests = (ROOT / ".agents/skills/author-tests/references/contract.md").read_text()
        security = (ROOT / ".agents/skills/review-security/references/rubric.md").read_text()
        qa = (ROOT / ".agents/skills/verify-qa/references/contract.md").read_text()
        quality = (ROOT / ".agents/skills/review-code-quality/references/rubric.md").read_text()
        self.assertIn("Production code has one writer", construction)
        self.assertIn("Do not change production sources", tests)
        self.assertIn("Return `fail` for any validated risk", security)
        self.assertIn("Missing required runtime access", qa)
        self.assertIn("Every validated finding is blocking", (ROOT / ".agents/skills/review-code-quality/SKILL.md").read_text())
        self.assertIn("code-judo", quality)

    def test_scenario_fixture_has_decision_complete_outcomes(self):
        scenarios = json.loads((ROOT / "tests/fixtures/scenarios.json").read_text())
        self.assertEqual(scenarios["happy_path"]["terminal_owner"], "human")
        self.assertEqual(scenarios["ci_failure"]["next_stage"], "construction")
        self.assertEqual(scenarios["requested_changes"]["fresh_attempt_budget"], 3)
        self.assertEqual(scenarios["contradictory_feedback"]["next_stage"], "human-decision")
        self.assertFalse(scenarios["qa_runtime_unavailable"]["publish"])
        self.assertFalse(scenarios["validated_quality_finding"]["publish"])
        self.assertEqual(scenarios["third_failed_cycle"]["attempt"], 3)
        self.assertTrue(scenarios["worktree_isolation"]["required"])
        self.assertEqual(
            scenarios["worktree_isolation"]["writable_stages"],
            ["construction", "author-tests", "remediation"],
        )
        self.assertTrue(scenarios["worktree_isolation"]["copy_ignored_env_files"])
        self.assertFalse(scenarios["worktree_isolation"]["copy_env_symlinks"])
        self.assertTrue(scenarios["worktree_isolation"]["block_modified_tracked_env_files"])
        self.assertTrue(scenarios["worktree_isolation"]["block_destination_symlink_ancestors"])
        self.assertEqual(scenarios["human_boundary"]["agent_must_not"], ["merge", "deploy"])


if __name__ == "__main__":
    unittest.main()
