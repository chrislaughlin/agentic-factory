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
            first = install(home, "--harness", "all")
            self.assertIn("installed", first.stdout)
            self.assertEqual(len(list((home / ".agents/skills").glob("*/SKILL.md"))), 12)
            self.assertEqual(len(list((home / ".codex/agents").glob("*.toml"))), 9)
            self.assertEqual(len(list((home / ".claude/agents").glob("*.md"))), 9)
            self.assertEqual(len(list((home / ".config/opencode/agents").glob("*.md"))), 9)
            second = install(home, "--harness", "all")
            self.assertNotIn("installed", second.stdout)
            self.assertIn("unchanged", second.stdout)

    def test_collision_refuses_without_force_and_force_backs_up(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / ".codex/agents/construct-work.toml"
            target.parent.mkdir(parents=True)
            target.write_text("personal content\n")
            refused = install(home, "--harness", "codex", check=False)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("Refusing to overwrite", refused.stderr)
            forced = install(home, "--harness", "codex", "--force")
            self.assertEqual(forced.returncode, 0)
            backups = list(target.parent.glob("construct-work.toml.agent-factory-backup-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), "personal content\n")

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
