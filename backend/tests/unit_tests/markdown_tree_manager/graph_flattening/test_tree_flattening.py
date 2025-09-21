#!/usr/bin/env python3
"""
Behavioral test for tree_flattening module.
Verifies that tree structure and content ordering are correct.
"""

import sys
from pathlib import Path

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from backend.markdown_tree_manager.graph_flattening.tree_flattening import flatten_tree


def test_tree_flattening_with_target_and_neighbors():
    """
    Test tree flattening with a target node, its parents, children, and neighbors.
    Verifies correct ASCII tree visualization and content ordering.
    """
    # Create test nodes with hierarchy
    nodes = [
        {
            'filename': 'root.md',
            'title': 'Root Node',
            'content': '---\nnode_id: 1\ntitle: Root Node\n---\nThis is the root node content.',
            'depth': 2,  # Grandparent of target
            'node_id': '1'
        },
        {
            'filename': 'parent1.md',
            'title': 'Parent 1',
            'content': '---\nnode_id: 2\ntitle: Parent 1\n---\nThis is parent 1 content.',
            'depth': 1,  # Parent of target
            'node_id': '2'
        },
        {
            'filename': 'target.md',
            'title': 'Target Node',
            'content': '---\nnode_id: 3\ntitle: Target Node\n---\nThis is the target node with search match.',
            'depth': 0,
            'is_target': True,
            'node_id': '3'
        },
        {
            'filename': 'child1.md',
            'title': 'Child 1',
            'content': '---\nnode_id: 4\ntitle: Child 1\n---\nThis is child 1 content.',
            'depth': -1,  # Child of target
            'node_id': '4'
        },
        {
            'filename': 'child2.md',
            'title': 'Child 2',
            'content': '---\nnode_id: 5\ntitle: Child 2\n---\nThis is child 2 content.',
            'depth': -2,  # Grandchild of target
            'node_id': '5'
        },
        {
            'filename': 'sibling.md',
            'title': 'Sibling Node',
            'content': '---\nnode_id: 6\ntitle: Sibling Node\n---\nThis is a sibling (neighbor) of target.',
            'depth': 0,
            'neighbor_of_target': True,
            'node_id': '6'
        }
    ]

    # Generate flattened output
    result = flatten_tree(nodes)

    # Verify structure sections exist
    assert "=== TREE STRUCTURE ===" in result, "Missing tree structure section"
    assert "=== NODE CONTENTS ===" in result, "Missing node contents section"

    # Split into sections
    parts = result.split("=== NODE CONTENTS ===")
    tree_section = parts[0]
    content_section = parts[1] if len(parts) > 1 else ""

    # Verify tree visualization contains expected elements
    assert "Root Node" in tree_section, "Root node missing from tree"
    assert "Target Node [*]" in tree_section, "Target node not marked with [*]"
    assert "Sibling Node (neighbor)" in tree_section, "Neighbor not marked properly"

    # Verify ASCII tree characters are present
    assert "├──" in tree_section or "└──" in tree_section, "Missing tree branch characters"

    # Verify content ordering
    assert "[1]" in content_section, "Missing numbered content entry 1"
    assert "[2]" in content_section, "Missing numbered content entry 2"
    assert "[3]" in content_section, "Missing numbered content entry 3"

    # Verify content includes actual text
    assert "This is the root node content" in content_section, "Root content missing"
    assert "This is the target node with search match" in content_section, "Target content missing"
    assert "This is a sibling (neighbor) of target" in content_section, "Neighbor content missing"

    # Verify special markings in content section
    assert "Target Node [*]" in content_section or "[3] Target Node [*]" in content_section, \
        "Target not marked in content section"
    assert "Sibling Node (neighbor)" in content_section or "[6] Sibling Node (neighbor)" in content_section, \
        "Neighbor not marked in content section"

    print("✓ Tree flattening test passed")


def test_single_node_edge_case():
    """Test handling of single node (no parents, no children)."""
    nodes = [
        {
            'filename': 'single.md',
            'title': 'Single Node',
            'content': 'Just a single node.',
            'depth': 0,
            'is_target': True,
            'node_id': '1'
        }
    ]

    result = flatten_tree(nodes)

    assert "=== TREE STRUCTURE ===" in result
    assert "Single Node [*]" in result
    assert "[1] Single Node" in result
    assert "Just a single node" in result

    print("✓ Single node edge case test passed")


def test_empty_nodes_list():
    """Test handling of empty nodes list."""
    result = flatten_tree([])
    assert "No nodes to display" in result
    print("✓ Empty nodes test passed")


if __name__ == "__main__":
    # Run all tests
    test_tree_flattening_with_target_and_neighbors()
    test_single_node_edge_case()
    test_empty_nodes_list()
    print("\nAll tree flattening tests passed! ✓")