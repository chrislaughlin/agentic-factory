from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"


def install(home: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sh", str(INSTALLER), "--dest-home", str(home), *args],
        cwd=ROOT,
        check=check,
        text=True,
        capture_output=True,
    )


class InstallerTests(unittest.TestCase):
    def test_all_harnesses_install_and_second_run_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            first = install(home)
            self.assertIn("installed", first.stdout)
            source_skills = {path.parent.name for path in (ROOT / ".agents/skills").glob("*/SKILL.md")}
            installed_skills = {path.parent.name for path in (home / ".agents/skills").glob("*/SKILL.md")}
            self.assertEqual(installed_skills, source_skills)
            expected_roles = len(list((ROOT / "agents").glob("*.md")))
            self.assertEqual(len(list((home / ".codex/agents").glob("*.toml"))), expected_roles)
            self.assertEqual(len(list((home / ".claude/agents").glob("*.md"))), expected_roles)
            self.assertEqual(len(list((home / ".config/opencode/agents").glob("*.md"))), expected_roles)
            second = install(home)
            self.assertNotIn("installed", second.stdout)
            self.assertIn("unchanged", second.stdout)

    def test_differing_managed_items_are_updated_without_force(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / ".codex/agents/construct-work.toml"
            target.parent.mkdir(parents=True)
            target.write_text("personal content\n")
            result = install(home, "--harness", "codex")
            self.assertEqual(result.returncode, 0)
            self.assertEqual(target.read_text(), (ROOT / "adapters/codex/construct-work.toml").read_text())
            self.assertNotIn("--force", result.stdout + result.stderr)

    def test_legacy_skill_backups_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target_parent = home / ".agents/skills"
            backup = target_parent / "do-work.agent-factory-backup-20260813T204950Z"
            backup.mkdir(parents=True)
            (backup / "SKILL.md").write_text("old version\n")
            install(home, "--harness", "codex")
            self.assertFalse(backup.exists())
            self.assertTrue((target_parent / "do-work/SKILL.md").exists())

    def test_differing_skill_directories_are_updated_in_place(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / ".agents/skills/do-work"
            target.mkdir(parents=True)
            (target / "SKILL.md").write_text("old version\n")
            (target / "user-file.txt").write_text("old managed contents\n")
            install(home, "--harness", "codex")
            self.assertEqual((target / "SKILL.md").read_text(), (ROOT / ".agents/skills/do-work/SKILL.md").read_text())
            self.assertFalse((target / "user-file.txt").exists())

    def test_link_mode_links_to_canonical_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            install(home, "--harness", "opencode", "--mode", "link")
            skill = home / ".config/opencode/skills/do-work"
            agent = home / ".config/opencode/agents/watch-change.md"
            self.assertTrue(skill.is_symlink())
            self.assertTrue(agent.is_symlink())
            self.assertEqual(skill.resolve(), ROOT / ".agents/skills/do-work")
            self.assertEqual(agent.resolve(), ROOT / "adapters/opencode/watch-change.md")


if __name__ == "__main__":
    unittest.main()
