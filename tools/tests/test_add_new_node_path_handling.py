"""
Test for add_new_node.py path handling.

Tests the scenario where parent paths are passed in different formats
and verifies the correct absolute path is computed.
"""

import pytest
from pathlib import Path
import sys
import os

# Add tools directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestPathResolution:
    """Test path resolution logic in add_new_node.py"""

    def test_path_with_project_suffix_included(self, tmp_path: Path):
        """
        When OBSIDIAN_PROJECT_PATH=/tmp/watched/vt and parent_path="vt/ctx-nodes/file.md",
        the resolved path should be /tmp/watched/vt/ctx-nodes/file.md (NOT doubled).

        This is the common case where node IDs (relative to watched folder) are passed.
        """
        # Setup: simulate watched folder structure
        watched_folder = tmp_path / "watched"
        project_suffix = "vt"
        project_path = watched_folder / project_suffix
        project_path.mkdir(parents=True)

        # Create parent file
        ctx_nodes = project_path / "ctx-nodes"
        ctx_nodes.mkdir()
        parent_file = ctx_nodes / "parent.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Parent")

        # The path as it would be passed (node ID format, relative to watched folder)
        parent_path_input = "vt/ctx-nodes/parent.md"

        # Current logic (BROKEN):
        # OBSIDIAN_PROJECT_PATH = watched_folder/vt
        # full_path = OBSIDIAN_PROJECT_PATH / parent_path_input
        #           = /tmp/watched/vt / vt/ctx-nodes/parent.md
        #           = /tmp/watched/vt/vt/ctx-nodes/parent.md  <-- DOUBLED!

        current_logic_result = project_path / parent_path_input

        # Expected correct path
        expected_path = project_path / "ctx-nodes" / "parent.md"

        # This assertion shows the bug - current logic produces wrong path
        assert current_logic_result != expected_path, "Current logic should produce wrong path"
        assert "vt/vt" in str(current_logic_result), f"Path should be doubled: {current_logic_result}"

    def test_path_with_project_suffix_included_fixed(self, tmp_path: Path):
        """
        With the fix: strip project folder name if path starts with it.
        """
        watched_folder = tmp_path / "watched"
        project_suffix = "vt"
        project_path = watched_folder / project_suffix
        project_path.mkdir(parents=True)

        ctx_nodes = project_path / "ctx-nodes"
        ctx_nodes.mkdir()
        parent_file = ctx_nodes / "parent.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Parent")

        parent_path_input = "vt/ctx-nodes/parent.md"
        parent_path = Path(parent_path_input)

        # Fix: strip project folder name if included
        project_name = project_path.name  # "vt"
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        fixed_result = project_path / parent_path
        expected_path = project_path / "ctx-nodes" / "parent.md"

        assert fixed_result == expected_path, f"Fixed logic should produce correct path: {fixed_result} != {expected_path}"
        assert fixed_result.exists(), "Fixed path should point to existing file"

    def test_path_without_project_suffix_unchanged(self, tmp_path: Path):
        """
        Paths that don't include project suffix should work unchanged.
        """
        watched_folder = tmp_path / "watched"
        project_suffix = "vt"
        project_path = watched_folder / project_suffix
        project_path.mkdir(parents=True)

        ctx_nodes = project_path / "ctx-nodes"
        ctx_nodes.mkdir()
        parent_file = ctx_nodes / "parent.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Parent")

        # Path without project suffix (relative to project)
        parent_path_input = "ctx-nodes/parent.md"
        parent_path = Path(parent_path_input)

        # Fix should not change this path
        project_name = project_path.name
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        result = project_path / parent_path
        expected_path = project_path / "ctx-nodes" / "parent.md"

        assert result == expected_path
        assert result.exists()


class TestAlternativeApproach:
    """
    Test alternative approach: use WATCHED_FOLDER instead of OBSIDIAN_PROJECT_PATH.

    In this approach, paths are always relative to watched folder (include project suffix).
    """

    def test_watched_folder_approach(self, tmp_path: Path):
        """
        When WATCHED_FOLDER=/tmp/watched and parent_path="vt/ctx-nodes/file.md",
        the resolved path is simply WATCHED_FOLDER / parent_path.
        """
        watched_folder = tmp_path / "watched"
        project_suffix = "vt"
        project_path = watched_folder / project_suffix
        project_path.mkdir(parents=True)

        ctx_nodes = project_path / "ctx-nodes"
        ctx_nodes.mkdir()
        parent_file = ctx_nodes / "parent.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Parent")

        # Path as node ID (relative to watched folder)
        parent_path_input = "vt/ctx-nodes/parent.md"

        # Alternative logic: use watched folder directly
        result = watched_folder / parent_path_input
        expected_path = project_path / "ctx-nodes" / "parent.md"

        assert result == expected_path
        assert result.exists()

    def test_watched_folder_approach_fails_without_project_suffix(self, tmp_path: Path):
        """
        IMPORTANT: With watched folder approach, paths MUST include project suffix.
        Paths without project suffix would resolve incorrectly.
        """
        watched_folder = tmp_path / "watched"
        project_suffix = "vt"
        project_path = watched_folder / project_suffix
        project_path.mkdir(parents=True)

        ctx_nodes = project_path / "ctx-nodes"
        ctx_nodes.mkdir()
        parent_file = ctx_nodes / "parent.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Parent")

        # Path WITHOUT project suffix (would be wrong with watched folder approach)
        parent_path_input = "ctx-nodes/parent.md"

        result = watched_folder / parent_path_input
        expected_path = project_path / "ctx-nodes" / "parent.md"

        # This shows the watched folder approach FAILS for paths without project suffix
        assert result != expected_path, "Watched folder approach fails without project suffix in path"
        assert not result.exists(), "Path without project suffix doesn't exist"


class TestComparisonSummary:
    """
    Summary: Both approaches work but have different requirements:

    1. OBSIDIAN_PROJECT_PATH + strip prefix fix:
       - OBSIDIAN_PROJECT_PATH = watched_folder/project_suffix
       - Accepts BOTH "vt/ctx-nodes/file.md" AND "ctx-nodes/file.md"
       - More flexible/forgiving

    2. WATCHED_FOLDER approach:
       - WATCHED_FOLDER = watched_folder
       - ONLY accepts "vt/ctx-nodes/file.md" (must include project suffix)
       - Simpler logic but stricter input requirements
    """

    def test_strip_prefix_accepts_both_formats(self, tmp_path: Path):
        """Strip prefix approach accepts both path formats."""
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        def resolve_with_strip_prefix(project_path: Path, parent_input: str) -> Path:
            parent_path = Path(parent_input)
            project_name = project_path.name
            if parent_path.parts and parent_path.parts[0] == project_name:
                parent_path = Path(*parent_path.parts[1:])
            return project_path / parent_path

        # Both formats work
        assert resolve_with_strip_prefix(project_path, "vt/ctx-nodes/file.md").exists()
        assert resolve_with_strip_prefix(project_path, "ctx-nodes/file.md").exists()

    def test_watched_folder_only_accepts_full_path(self, tmp_path: Path):
        """Watched folder approach only accepts paths with project suffix."""
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        def resolve_with_watched_folder(watched_folder: Path, parent_input: str) -> Path:
            return watched_folder / parent_input

        # Only full path format works
        assert resolve_with_watched_folder(watched_folder, "vt/ctx-nodes/file.md").exists()
        assert not resolve_with_watched_folder(watched_folder, "ctx-nodes/file.md").exists()


class TestEdgeCases:
    """
    Edge cases for path resolution that could break either approach.
    """

    # ========== ABSOLUTE PATHS ==========

    def test_absolute_path_bypasses_project_logic(self, tmp_path: Path):
        """
        Absolute paths should work directly without project path joining.
        Current add_new_node.py handles this in a separate branch.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        parent_file = project_path / "ctx-nodes" / "file.md"
        parent_file.write_text("---\nnode_id: 1\n---\n# Test")

        # Absolute path input
        parent_path_input = str(parent_file)  # e.g., /tmp/.../watched/vt/ctx-nodes/file.md

        parent_path = Path(parent_path_input)

        # Current logic: if absolute, use directly
        if parent_path.is_absolute():
            full_parent_path = parent_path
            project_dir = parent_path.parent  # Used for finding other files
        else:
            # This branch not taken for absolute paths
            project_dir = project_path
            full_parent_path = project_dir / parent_path

        assert full_parent_path.exists()
        assert full_parent_path == parent_file

    def test_absolute_path_works_for_both_approaches(self, tmp_path: Path):
        """Both approaches handle absolute paths the same way."""
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        parent_file = project_path / "ctx-nodes" / "file.md"
        parent_file.write_text("# Test")

        abs_path = str(parent_file)

        # Both approaches: absolute paths are used directly
        assert Path(abs_path).exists()

    # ========== PATHS WITH ./ PREFIX ==========

    def test_dot_slash_prefix_normalized_by_path(self, tmp_path: Path):
        """
        Python's Path() normalizes './' away automatically.
        Path('./vt/file.md').parts = ('vt', 'file.md'), NOT ('.', 'vt', 'file.md')

        This means ./ prefix is NOT an edge case - it works correctly!
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        # Path with ./ prefix - Python normalizes it away
        parent_path_input = "./vt/ctx-nodes/file.md"
        parent_path = Path(parent_path_input)

        # Python normalizes ./ away - parts start with 'vt', not '.'
        assert parent_path.parts[0] == "vt", f"Path normalizes ./: {parent_path.parts}"

        # Strip prefix logic works because first part IS 'vt'
        project_name = project_path.name  # "vt"
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        result = project_path / parent_path
        expected = project_path / "ctx-nodes" / "file.md"

        # ./ prefix works correctly due to Path normalization
        assert result == expected, f"Strip logic works with ./ prefix: {result}"
        assert result.exists()

    def test_dot_slash_prefix_watched_folder_approach(self, tmp_path: Path):
        """
        Watched folder approach also handles ./ prefix correctly via Path normalization.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        parent_path_input = "./vt/ctx-nodes/file.md"

        result = watched_folder / parent_path_input
        expected = project_path / "ctx-nodes" / "file.md"

        # Result: /watched/./vt/ctx-nodes/file.md which normalizes to /watched/vt/ctx-nodes/file.md
        # Actually Path normalizes this, so it might work!
        assert result.resolve() == expected.resolve(), "Watched folder handles ./ via path normalization"

    # ========== EMPTY PROJECT SUFFIX ==========

    def test_empty_project_suffix_strip_logic(self, tmp_path: Path):
        """
        When project suffix is empty, OBSIDIAN_PROJECT_PATH = watched_folder.
        project_name becomes the watched folder's name (e.g., 'watched').

        If path happens to start with 'watched/', it would incorrectly strip it!
        """
        watched_folder = tmp_path / "watched"
        watched_folder.mkdir(parents=True)
        (watched_folder / "ctx-nodes").mkdir()
        (watched_folder / "ctx-nodes" / "file.md").write_text("# Test")

        # No project suffix - project IS the watched folder
        project_path = watched_folder

        # Path that happens to start with the folder name
        parent_path_input = "watched/ctx-nodes/file.md"  # Unlikely but possible edge case
        parent_path = Path(parent_path_input)

        project_name = project_path.name  # "watched"

        # Strip logic would incorrectly strip "watched/"
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        result = project_path / parent_path
        # Result: /tmp/.../watched/ctx-nodes/file.md - stripped "watched" incorrectly

        # The path "watched/ctx-nodes/file.md" relative to watched_folder should NOT strip
        # But our logic does strip it because project_name == "watched"

        # This is a potential bug if someone has paths starting with the project folder name
        # In practice this is unlikely since paths are usually like "vt/..." or "voicetree/..."

    def test_empty_project_suffix_watched_folder_approach(self, tmp_path: Path):
        """
        With empty project suffix, watched folder approach still works correctly.
        Paths are just relative to watched folder directly.
        """
        watched_folder = tmp_path / "watched"
        watched_folder.mkdir(parents=True)
        (watched_folder / "ctx-nodes").mkdir()
        (watched_folder / "ctx-nodes" / "file.md").write_text("# Test")

        parent_path_input = "ctx-nodes/file.md"

        result = watched_folder / parent_path_input
        expected = watched_folder / "ctx-nodes" / "file.md"

        assert result == expected
        assert result.exists()

    # ========== CASE SENSITIVITY ==========

    def test_case_mismatch_strip_logic(self, tmp_path: Path):
        """
        Case sensitivity: 'VT' != 'vt' in Python string comparison.
        On macOS (case-insensitive FS), the file exists but strip logic won't match.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"  # lowercase
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        # User passes uppercase VT
        parent_path_input = "VT/ctx-nodes/file.md"
        parent_path = Path(parent_path_input)

        project_name = project_path.name  # "vt" lowercase

        # Strip logic: 'VT' != 'vt', so no strip
        original_parts = parent_path.parts
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        # Path unchanged
        assert parent_path.parts == original_parts, "Case mismatch prevents strip"

        result = project_path / parent_path
        # Result: /watched/vt/VT/ctx-nodes/file.md - doubled with different cases

        expected = project_path / "ctx-nodes" / "file.md"
        assert result != expected, "Case mismatch causes path doubling"

    def test_case_mismatch_watched_folder(self, tmp_path: Path):
        """
        Watched folder approach with case mismatch.
        On macOS (case-insensitive), VT/... resolves to vt/...
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        parent_path_input = "VT/ctx-nodes/file.md"  # uppercase

        result = watched_folder / parent_path_input

        # On case-insensitive filesystem (macOS), this resolves correctly
        # On case-sensitive filesystem (Linux), this would fail
        import platform
        if platform.system() == "Darwin":  # macOS
            # Case-insensitive: VT resolves to vt
            assert result.exists(), "macOS case-insensitive: VT -> vt"
        # On Linux, result.exists() would be False

    # ========== MISMATCHED PROJECT SUFFIX ==========

    def test_mismatched_project_suffix_strip_logic(self, tmp_path: Path):
        """
        User's project is 'voicetree' but they pass path starting with 'vt'.
        Strip logic won't match, so path gets doubled.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "voicetree"  # Different suffix
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        # User mistakenly uses 'vt' prefix
        parent_path_input = "vt/ctx-nodes/file.md"
        parent_path = Path(parent_path_input)

        project_name = project_path.name  # "voicetree"

        # Strip logic: 'vt' != 'voicetree', no strip
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        result = project_path / parent_path
        # Result: /watched/voicetree/vt/ctx-nodes/file.md

        expected = project_path / "ctx-nodes" / "file.md"
        assert result != expected
        assert not result.exists(), "Mismatched prefix creates non-existent path"

    def test_mismatched_project_suffix_watched_folder(self, tmp_path: Path):
        """
        Watched folder approach with mismatched suffix also fails.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "voicetree"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("# Test")

        # Wrong prefix
        parent_path_input = "vt/ctx-nodes/file.md"

        result = watched_folder / parent_path_input
        # Result: /watched/vt/ctx-nodes/file.md - wrong folder

        assert not result.exists(), "Wrong prefix leads to non-existent path"

    # ========== NESTED PROJECT SUFFIX (vt/vt/...) ==========

    def test_nested_project_suffix_only_strips_once(self, tmp_path: Path):
        """
        Path like 'vt/vt/file.md' should only strip the first 'vt'.
        Result should be vt/file.md, not file.md.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        # Create nested vt folder (unlikely but valid)
        (project_path / "vt").mkdir()
        (project_path / "vt" / "file.md").write_text("# Test")

        parent_path_input = "vt/vt/file.md"
        parent_path = Path(parent_path_input)

        project_name = project_path.name  # "vt"

        # Strip first occurrence only
        if parent_path.parts and parent_path.parts[0] == project_name:
            parent_path = Path(*parent_path.parts[1:])

        # After strip: vt/file.md (one vt removed)
        assert parent_path == Path("vt/file.md"), f"Should strip only first vt: {parent_path}"

        result = project_path / parent_path
        # Result: /watched/vt/vt/file.md - correct!

        expected = project_path / "vt" / "file.md"
        assert result == expected
        assert result.exists()


class TestNewDefaultBehavior:
    """
    Tests for the new default behavior where:
    1. WATCHED_FOLDER is tried first (direct join)
    2. Falls back to OBSIDIAN_PROJECT_PATH with strip-prefix only when path doesn't exist

    This mimics the actual logic in add_new_node.py after the fix.
    """

    def resolve_path_new_logic(
        self,
        parent_path_input: str,
        watched_folder: Path | None,
        project_path: Path | None
    ) -> tuple[Path, Path]:
        """
        Mimics the new path resolution logic in add_new_node.py.
        Returns (full_parent_path, project_dir).
        """
        parent_path = Path(parent_path_input)

        if watched_folder:
            full_parent_path = watched_folder / parent_path

            # If this path exists, use watched_folder as project_dir
            if full_parent_path.exists():
                return full_parent_path, watched_folder
            # Fallback: try project_path with strip-prefix logic
            elif project_path:
                adjusted_path = parent_path
                project_name = project_path.name
                if adjusted_path.parts and adjusted_path.parts[0] == project_name:
                    adjusted_path = Path(*adjusted_path.parts[1:])
                return project_path / adjusted_path, project_path
            else:
                # Keep the WATCHED_FOLDER path even if it doesn't exist
                return full_parent_path, watched_folder
        elif project_path:
            # Legacy fallback: use project_path with strip-prefix logic
            project_name = project_path.name
            if parent_path.parts and parent_path.parts[0] == project_name:
                parent_path = Path(*parent_path.parts[1:])
            return project_path / parent_path, project_path
        else:
            raise ValueError("No WATCHED_FOLDER or OBSIDIAN_PROJECT_PATH")

    def test_watched_folder_is_default_when_path_exists(self, tmp_path: Path):
        """
        When WATCHED_FOLDER is set and path exists, use it directly (no strip-prefix).
        This is the new default behavior.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("---\nnode_id: 1\n---\n# Test")

        parent_path_input = "vt/ctx-nodes/file.md"

        full_path, project_dir = self.resolve_path_new_logic(
            parent_path_input, watched_folder, project_path
        )

        expected_path = project_path / "ctx-nodes" / "file.md"
        assert full_path == expected_path
        assert full_path.exists()
        # project_dir should be watched_folder, not project_path
        assert project_dir == watched_folder

    def test_fallback_to_strip_prefix_when_watched_path_not_exist(self, tmp_path: Path):
        """
        When WATCHED_FOLDER path doesn't exist but strip-prefix path does,
        fall back to strip-prefix.

        This handles the case where someone passes a project-relative path
        without the project suffix.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("---\nnode_id: 1\n---\n# Test")

        # Path without project suffix - doesn't exist at watched_folder/ctx-nodes/file.md
        parent_path_input = "ctx-nodes/file.md"

        full_path, project_dir = self.resolve_path_new_logic(
            parent_path_input, watched_folder, project_path
        )

        expected_path = project_path / "ctx-nodes" / "file.md"
        assert full_path == expected_path
        assert full_path.exists()
        # Should have fallen back to project_path
        assert project_dir == project_path

    def test_legacy_project_path_only_still_works(self, tmp_path: Path):
        """
        When only OBSIDIAN_PROJECT_PATH is set (no WATCHED_FOLDER),
        legacy strip-prefix logic is used.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("---\nnode_id: 1\n---\n# Test")

        parent_path_input = "vt/ctx-nodes/file.md"

        # No WATCHED_FOLDER, only project_path
        full_path, project_dir = self.resolve_path_new_logic(
            parent_path_input, None, project_path
        )

        expected_path = project_path / "ctx-nodes" / "file.md"
        assert full_path == expected_path
        assert full_path.exists()
        assert project_dir == project_path

    def test_both_formats_work_with_new_logic(self, tmp_path: Path):
        """
        New logic accepts both "vt/ctx-nodes/file.md" (via watched_folder)
        and "ctx-nodes/file.md" (via fallback to strip-prefix).
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("---\nnode_id: 1\n---\n# Test")

        # Format 1: with project suffix (watched_folder default)
        full_path1, _ = self.resolve_path_new_logic(
            "vt/ctx-nodes/file.md", watched_folder, project_path
        )
        assert full_path1.exists()

        # Format 2: without project suffix (fallback to strip-prefix)
        full_path2, _ = self.resolve_path_new_logic(
            "ctx-nodes/file.md", watched_folder, project_path
        )
        assert full_path2.exists()

        # Both resolve to the same file
        assert full_path1 == full_path2

    def test_no_unnecessary_fallback_when_watched_path_works(self, tmp_path: Path):
        """
        Verify we don't use the fallback when the default path works.
        This ensures cleaner project_dir assignment.
        """
        watched_folder = tmp_path / "watched"
        project_path = watched_folder / "vt"
        project_path.mkdir(parents=True)
        (project_path / "ctx-nodes").mkdir()
        (project_path / "ctx-nodes" / "file.md").write_text("---\nnode_id: 1\n---\n# Test")

        parent_path_input = "vt/ctx-nodes/file.md"

        full_path, project_dir = self.resolve_path_new_logic(
            parent_path_input, watched_folder, project_path
        )

        # Should use watched_folder (not project_path) since default worked
        assert project_dir == watched_folder
        # This is important for correct relative path calculation later
