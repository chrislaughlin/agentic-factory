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

    def test_orchestrator_discovers_repository_context_without_setup_step(self):
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        discovery = (ROOT / ".agents/skills/do-work/references/repository-discovery.md").read_text()
        runtime_text = "\n".join(
            path.read_text()
            for path in (ROOT / ".agents/skills").glob("**/*.md")
        )
        self.assertFalse((ROOT / ".agents/skills/setup-agent-factory").exists())
        self.assertNotIn(".agent-factory/project.md", runtime_text)
        self.assertIn("Discover the repository context", do_work)
        self.assertIn("Do not create a repository configuration file", discovery)
        self.assertIn("Repository context", (ROOT / ".agents/skills/do-work/references/journal.md").read_text())

    def test_product_shaping_lifecycle_has_human_gates_and_delivery_contract(self):
        shape = (ROOT / ".agents/skills/shape-work/SKILL.md").read_text()
        lifecycle = (ROOT / ".agents/skills/shape-work/references/lifecycle.md").read_text()
        contract = (ROOT / ".agents/skills/shape-work/references/work-item-contract.md").read_text()
        methods = (ROOT / ".agents/skills/shape-work/references/methods.md").read_text()
        self.assertIn("Ask exactly one material human decision at a time", shape)
        self.assertIn("Wait for explicit human approval", shape)
        self.assertIn("Never start implementation automatically", shape)
        self.assertIn("advance", lifecycle)
        self.assertIn("experiment", lifecycle)
        self.assertIn("Evidence", contract)
        self.assertIn("Acceptance criteria", contract)
        self.assertIn("Lean", methods)
        self.assertIn("Design Thinking", methods)
        self.assertIn("Dual-Track", methods)
        self.assertIn("Scrum", methods)
        self.assertIn("Kanban", methods)
        self.assertIn("Phase-gated", methods)

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

    def test_planning_specialists_and_iterative_human_gate(self):
        manifest = json.loads((ROOT / "agents/manifest.json").read_text())
        for role in ("map-codebase", "design-solution", "review-technical-plan"):
            self.assertEqual(manifest["roles"][role]["permission"], "read-only")
            skill = (ROOT / ".agents/skills" / role / "SKILL.md").read_text()
            self.assertIn("read-only", skill)
            self.assertIn("do not spawn agents", skill)
        do_work = (ROOT / ".agents/skills/do-work/SKILL.md").read_text()
        self.assertLess(do_work.index("`map-codebase`"), do_work.index("`design-solution`"))
        self.assertIn("Technical Blueprint", do_work)
        self.assertIn("Wait for explicit approval", do_work)
        self.assertIn("not for minimizing questions", do_work)

    def test_construction_checkpoint_and_access_fail_closed(self):
        workflow = (ROOT / ".agents/skills/do-work/references/workflow.md").read_text()
        contract = (ROOT / ".agents/skills/construct-work/references/contract.md").read_text()
        self.assertIn("non-empty `git diff --name-only", workflow)
        self.assertIn("unchanged control fingerprint", workflow)
        self.assertIn("must not consume a remediation attempt", (ROOT / ".agents/skills/do-work/SKILL.md").read_text())
        self.assertIn("Before reading implementation code", contract)
        self.assertNotIn("checkpoint SHA or unchanged SHA", contract)

    def test_environment_parity_and_scenario_regressions(self):
        worktree = (ROOT / ".agents/skills/do-work/references/worktree.md").read_text()
        self.assertIn("`*.env`", worktree)
        self.assertIn("Docker/Compose `env_file`", worktree)
        self.assertIn("before `verify-qa`", worktree)
        scenarios = json.loads((ROOT / "tests/fixtures/scenarios.json").read_text())
        for name in ("unchanged_construction_sha", "head_revision_mismatch", "empty_checkpoint_diff", "out_of_scope_checkpoint", "control_checkout_mutation"):
            self.assertFalse(scenarios[name].get("verification_starts", False))
        self.assertEqual(scenarios["worktree_access_failure"]["resume_stage"], "construction")
        self.assertFalse(scenarios["environment_parity_failure"]["runtime_starts"])


if __name__ == "__main__":
    unittest.main()
