"""
Unit test to reproduce the bug where node IDs keep getting appended to titles
when TreeToMarkdownConverter is called multiple times.
"""

import os
import tempfile
from pathlib import Path

import pytest

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_tree_ds import Node, MarkdownTree
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)


class TestTreeToMarkdownNodeIdBug:
    """Test that node IDs don't get repeatedly appended to titles"""

    def test_multiple_conversions_should_not_duplicate_node_id_in_title(self):
        """
        Test that when TreeToMarkdownConverter is called multiple times,
        it doesn't keep appending the node ID to the title.
        """
        # Create a simple tree with one node
        tree = MarkdownTree()
        node_id = tree.create_new_node(
            name="Test Node",
            content="This is test content",
            parent_node_id=None,
            summary=""
        )

        # Create a temporary directory for output
        with tempfile.TemporaryDirectory() as temp_dir:
            converter = TreeToMarkdownConverter(tree.tree)

            # First conversion
            converter.convert_nodes(
                output_dir=temp_dir, nodes_to_update=[node_id]
            )

            # Load the markdown file and check the title
            loaded_tree = load_markdown_tree(temp_dir)
            first_title = loaded_tree.tree[node_id].title

            # The title should have the node ID appended once
            assert first_title == f"Test Node ({node_id})", (
                f"After first conversion, title should be 'Test Node ({node_id})', "
                f"but got '{first_title}'"
            )

            # Second conversion (simulating what happens when the workflow runs again)
            converter2 = TreeToMarkdownConverter(loaded_tree.tree)
            converter2.convert_nodes(
                output_dir=temp_dir, nodes_to_update=[node_id]
            )

            # Load again and check the title
            loaded_tree2 = load_markdown_tree(temp_dir)
            second_title = loaded_tree2.tree[node_id].title

            # The title should still only have the node ID appended once, not twice!
            assert second_title == f"Test Node ({node_id})", (
                f"After second conversion, title should still be 'Test Node ({node_id})', "
                f"but got '{second_title}'. Node ID was appended multiple times!"
            )

    def test_node_already_with_id_in_title_should_not_get_duplicated(self):
        """
        Test that if a node already has the node ID in its title,
        it doesn't get appended again.
        """
        tree = MarkdownTree()

        # Create a node that already has the ID in its title (simulating a loaded node)
        node_id = 36
        tree.tree[node_id] = Node(
            name="Meta-commentary on Node Connection Testing (36)",
            node_id=node_id,
            content="Test content",
            parent_id=None,
            summary=""
        )
        tree.next_node_id = 37

        with tempfile.TemporaryDirectory() as temp_dir:
            converter = TreeToMarkdownConverter(tree.tree)
            converter.convert_nodes(
                output_dir=temp_dir, nodes_to_update=[node_id]
            )

            # Load and check the title
            loaded_tree = load_markdown_tree(temp_dir)
            result_title = loaded_tree.tree[node_id].title

            # The title should not have the node ID appended twice
            assert result_title == "Meta-commentary on Node Connection Testing (36)", (
                f"Title should remain 'Meta-commentary on Node Connection Testing (36)', "
                f"but got '{result_title}'"
            )


if __name__ == "__main__":
    test = TestTreeToMarkdownNodeIdBug()
    test.test_multiple_conversions_should_not_duplicate_node_id_in_title()
    test.test_node_already_with_id_in_title_should_not_get_duplicated()
    print("All tests passed!")