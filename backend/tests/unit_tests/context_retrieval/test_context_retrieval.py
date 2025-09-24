#!/usr/bin/env python3
"""
Behavioral test for the context_retrieval module's traverse_to_node function.
Tests the input/output behavior without implementation details.
"""

import shutil
import tempfile
from pathlib import Path

import pytest

from backend.context_retrieval.dependency_traversal import TraversalOptions
from backend.context_retrieval.dependency_traversal import traverse_to_node


class TestTraverseToNode:
    """Test the traverse_to_node function's behavior."""

    @pytest.fixture
    def temp_markdown_dir(self):
        """Create a temporary directory with test markdown files."""
        temp_dir = tempfile.mkdtemp()
        markdown_dir = Path(temp_dir) / "test_vault"
        markdown_dir.mkdir()

        # Create a simple tree structure
        # 1_Root.md -> 2_Parent.md -> 3_Target.md -> 4_Child.md

        # Root node
        (markdown_dir / "1_Root.md").write_text("""---
node_id: 1
title: Root Node
---
### This is the root node of our test tree.""")

        # Parent node with link to root
        (markdown_dir / "2_Parent.md").write_text("""---
node_id: 2
title: Parent Node
---
### This is the parent node

is_enabled_by [[1_Root.md]]""")

        # Target node with link to parent
        (markdown_dir / "3_Target.md").write_text("""---
node_id: 3
title: Target Node
---
### This is the target node we're traversing to

is_a_required_capability_for [[2_Parent.md]]""")

        # Child node with link to target
        (markdown_dir / "4_Child.md").write_text("""---
node_id: 4
title: Child Node
---
### This is a child node

implements_pseudocode_for [[3_Target.md]]""")

        # Sibling node (not directly connected)
        (markdown_dir / "5_Sibling.md").write_text("""---
node_id: 5
title: Sibling Node
---
### This is a sibling node

is_enabled_by [[2_Parent.md]]""")

        yield markdown_dir

        # Cleanup
        shutil.rmtree(temp_dir)

    def test_traverse_to_node_parents_only(self, temp_markdown_dir):
        """Test traversing to a node with only parent traversal."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=5
        )

        nodes = traverse_to_node("3_Target.md", temp_markdown_dir, options)

        # Should return [Root, Parent, Target] in that order
        assert len(nodes) == 3

        # Check filenames
        assert nodes[0]['filename'] == "1_Root.md"
        assert nodes[1]['filename'] == "2_Parent.md"
        assert nodes[2]['filename'] == "3_Target.md"

        # Check titles were extracted
        assert nodes[0]['title'] == "Root Node"
        assert nodes[1]['title'] == "Parent Node"
        assert nodes[2]['title'] == "Target Node"

        # Check depths
        assert nodes[0]['depth'] == 2  # Root is 2 levels up from target
        assert nodes[1]['depth'] == 1  # Parent is 1 level up
        assert nodes[2]['depth'] == 0  # Target is at depth 0

    def test_traverse_to_node_with_children(self, temp_markdown_dir):
        """Test traversing to a node including children."""
        options = TraversalOptions(
            include_parents=False,
            include_children=True,
            max_depth=3
        )

        nodes = traverse_to_node("3_Target.md", temp_markdown_dir, options)

        # Should return [Target, Child]
        assert len(nodes) == 2

        assert nodes[0]['filename'] == "3_Target.md"
        assert nodes[1]['filename'] == "4_Child.md"

        # Check depths
        assert nodes[0]['depth'] == 0  # Target
        assert nodes[1]['depth'] == 1  # Child is 1 level down

    def test_traverse_to_node_both_directions(self, temp_markdown_dir):
        """Test traversing in both directions."""
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=5
        )

        nodes = traverse_to_node("3_Target.md", temp_markdown_dir, options)

        # Should return [Root, Parent, Target, Child]
        assert len(nodes) == 4

        # Check order and filenames
        filenames = [n['filename'] for n in nodes]
        assert filenames == ["1_Root.md", "2_Parent.md", "3_Target.md", "4_Child.md"]

    def test_traverse_with_max_depth_limit(self, temp_markdown_dir):
        """Test that max_depth limits traversal."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=1  # Only go 1 level up
        )

        nodes = traverse_to_node("3_Target.md", temp_markdown_dir, options)

        # Should return [Parent, Target] (Root is too far)
        assert len(nodes) == 2
        assert nodes[0]['filename'] == "2_Parent.md"
        assert nodes[1]['filename'] == "3_Target.md"

    def test_node_content_structure(self, temp_markdown_dir):
        """Test that nodes have the expected structure."""
        options = TraversalOptions(include_parents=False, include_children=False)

        nodes = traverse_to_node("3_Target.md", temp_markdown_dir, options)

        assert len(nodes) == 1
        node = nodes[0]

        # Check required fields
        assert 'filename' in node
        assert 'title' in node
        assert 'content' in node
        assert 'depth' in node

        # Check content includes the full markdown
        assert "node_id: 3" in node['content']
        assert "This is the target node" in node['content']
