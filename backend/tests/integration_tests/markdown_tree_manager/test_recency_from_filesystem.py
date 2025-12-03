"""
Integration tests for recency-based node retrieval from filesystem.

Tests the full pipeline:
1. Write markdown files to disk (some with YAML timestamps, some without)
2. Load tree from filesystem
3. Verify get_most_relevant_nodes correctly identifies recent nodes

This tests the fix for the bug where files without modified_at in YAML
were getting datetime.now() on each load, causing incorrect "most recent" detection.
"""
import os
import time
import tempfile
import pytest
from datetime import datetime, timedelta
from pathlib import Path

from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)


class TestRecencyFromFilesystem:
    """Integration tests for recency ordering with real filesystem operations"""

    def test_files_without_yaml_timestamps_use_file_mtime(self):
        """
        Test that files without modified_at in YAML use file mtime, not datetime.now().

        This is the core fix validation:
        - Old file (no YAML timestamp) should use its file mtime
        - New file (with YAML timestamp) should use the YAML timestamp
        - Most recent node should be correctly identified
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create an "old" file WITHOUT timestamps in YAML
            old_file_path = Path(tmpdir) / "1_Old_Node.md"
            old_file_content = """---
node_id: 1
---
# Old Node

### This is an old node without timestamps in YAML

Content of the old node.


-----------------
_Links:_
"""
            old_file_path.write_text(old_file_content)

            # Set the old file's mtime to 30 days ago
            old_mtime = time.time() - (30 * 24 * 60 * 60)  # 30 days ago
            os.utime(old_file_path, (old_mtime, old_mtime))

            # Create a "recent" file WITH timestamps in YAML
            recent_time = datetime.now()
            recent_file_path = Path(tmpdir) / "2_Recent_Node.md"
            recent_file_content = f"""---
node_id: 2
created_at: '{recent_time.isoformat()}'
modified_at: '{recent_time.isoformat()}'
---
# Recent Node

### This is a recently created node with timestamps

Content of the recent node.


-----------------
_Links:_
"""
            recent_file_path.write_text(recent_file_content)

            # Load tree from filesystem
            tree = load_markdown_tree(tmpdir)

            # Verify we loaded both nodes
            assert len(tree.tree) == 2, f"Expected 2 nodes, got {len(tree.tree)}"

            # Check that old node has old mtime (not datetime.now())
            old_node = tree.tree[1]
            recent_node = tree.tree[2]

            # Old node's modified_at should be ~30 days ago, not now
            time_diff_old = (datetime.now() - old_node.modified_at).total_seconds()
            assert time_diff_old > 29 * 24 * 60 * 60, (
                f"Old node should have modified_at ~30 days ago, "
                f"but diff is only {time_diff_old / 3600:.1f} hours. "
                f"modified_at={old_node.modified_at}"
            )

            # Recent node should have recent modified_at
            time_diff_recent = (datetime.now() - recent_node.modified_at).total_seconds()
            assert time_diff_recent < 60, (
                f"Recent node should have modified_at within last minute, "
                f"but diff is {time_diff_recent:.1f} seconds. "
                f"modified_at={recent_node.modified_at}"
            )

            # Most importantly: recent node should be more recent than old node
            assert recent_node.modified_at > old_node.modified_at, (
                f"Recent node should be newer than old node. "
                f"Recent: {recent_node.modified_at}, Old: {old_node.modified_at}"
            )

    def test_get_most_relevant_nodes_returns_actually_recent_nodes(self):
        """
        Full integration test: write files, load tree, call get_most_relevant_nodes.

        Verifies the complete pipeline correctly identifies the most recently
        modified nodes based on actual timestamps (not datetime.now() fallback).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            now = datetime.now()

            # Create 10 nodes with varying ages
            # Nodes 1-5: Old files without YAML timestamps (will use file mtime)
            # Nodes 6-10: Recent files with YAML timestamps
            for i in range(1, 11):
                file_path = Path(tmpdir) / f"{i}_Node_{i}.md"

                if i <= 5:
                    # Old nodes - no YAML timestamps
                    content = f"""---
node_id: {i}
---
# Node {i}

### Old node number {i}

Content for old node {i}.


-----------------
_Links:_
"""
                    file_path.write_text(content)
                    # Set mtime to i months ago
                    old_mtime = time.time() - (i * 30 * 24 * 60 * 60)
                    os.utime(file_path, (old_mtime, old_mtime))
                else:
                    # Recent nodes - with YAML timestamps
                    # Node 6 is oldest recent, node 10 is newest
                    node_time = now - timedelta(hours=(10 - i))
                    content = f"""---
node_id: {i}
created_at: '{node_time.isoformat()}'
modified_at: '{node_time.isoformat()}'
---
# Node {i}

### Recent node number {i}

Content for recent node {i}.


-----------------
_Links:_
"""
                    file_path.write_text(content)

            # Load tree
            tree = load_markdown_tree(tmpdir)
            assert len(tree.tree) == 10

            # Get most relevant nodes with limit that forces selection
            # With limit=5, should get 3/8 * 5 ≈ 1-2 recent nodes at minimum
            results = get_most_relevant_nodes(tree, limit=5, query=None)

            result_ids = [node.id for node in results]

            # Node 10 should definitely be included (most recent)
            assert 10 in result_ids, (
                f"Most recent node (10) should be in results. Got: {result_ids}"
            )

            # Verify ordering logic: recent nodes should be prioritized
            recent_ids_in_results = [id for id in result_ids if id >= 6]
            old_ids_in_results = [id for id in result_ids if id <= 5]

            # At least one recent node should be included
            assert len(recent_ids_in_results) >= 1, (
                f"At least 1 recent node should be included. "
                f"Recent: {recent_ids_in_results}, Old: {old_ids_in_results}"
            )

    def test_reload_preserves_correct_timestamps(self):
        """
        Test that reloading the tree multiple times preserves correct timestamps.

        This specifically tests the auto-sync scenario where the bug manifested:
        files without YAML timestamps would get datetime.now() on each reload,
        making them appear increasingly "recent".
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a file without YAML timestamps
            file_path = Path(tmpdir) / "1_Test_Node.md"
            content = """---
node_id: 1
---
# Test Node

### A test node

Content.


-----------------
_Links:_
"""
            file_path.write_text(content)

            # Set mtime to 1 day ago
            old_mtime = time.time() - (24 * 60 * 60)
            os.utime(file_path, (old_mtime, old_mtime))

            # Load tree first time
            tree1 = load_markdown_tree(tmpdir)
            first_load_modified_at = tree1.tree[1].modified_at

            # Wait a bit
            time.sleep(0.1)

            # Load tree second time (simulating auto-sync reload)
            tree2 = load_markdown_tree(tmpdir)
            second_load_modified_at = tree2.tree[1].modified_at

            # The modified_at should be the SAME on both loads
            # (Based on file mtime, not datetime.now())
            assert first_load_modified_at == second_load_modified_at, (
                f"modified_at should be consistent across reloads. "
                f"First load: {first_load_modified_at}, "
                f"Second load: {second_load_modified_at}"
            )

            # And it should be ~1 day ago, not now
            time_diff = (datetime.now() - first_load_modified_at).total_seconds()
            assert time_diff > 23 * 60 * 60, (
                f"modified_at should be ~1 day ago, not now. "
                f"Diff: {time_diff / 3600:.1f} hours"
            )
