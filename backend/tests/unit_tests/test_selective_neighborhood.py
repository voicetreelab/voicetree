#!/usr/bin/env python3
"""
Behavioral test for selective neighborhood inclusion.
Tests that neighborhoods are only added for target nodes, not for all nodes.
"""

import shutil
import tempfile
from pathlib import Path

from backend.context_retrieval.dependency_traversal import TraversalOptions
from backend.context_retrieval.dependency_traversal import traverse_to_node


def create_test_tree(temp_dir: Path):
    """Create a test markdown tree structure."""
    # Create root node
    root_file = temp_dir / "root.md"
    root_file.write_text("""---
node_id: root
title: Root Node
---
This is the root node.
""")

    # Create target node with parent link to root
    target_file = temp_dir / "target.md"
    target_file.write_text("""---
node_id: target
title: Target Node
---
This is a target node that links to [[root.md]].
""")

    # Create siblings of target (they also link to root)
    sibling1_file = temp_dir / "sibling1.md"
    sibling1_file.write_text("""---
node_id: sibling1
title: Sibling 1
---
This is sibling 1 that links to [[root.md]].
""")

    sibling2_file = temp_dir / "sibling2.md"
    sibling2_file.write_text("""---
node_id: sibling2
title: Sibling 2
---
This is sibling 2 that links to [[root.md]].
""")

    # Create child of target
    child_file = temp_dir / "child.md"
    child_file.write_text("""---
node_id: child
title: Child of Target
---
This is a child that links to [[target.md]].
""")

    # Create another branch with its own siblings
    other_parent_file = temp_dir / "other_parent.md"
    other_parent_file.write_text("""---
node_id: other_parent
title: Other Parent
---
This is another parent node linking to [[root.md]].
""")

    other_child1_file = temp_dir / "other_child1.md"
    other_child1_file.write_text("""---
node_id: other_child1
title: Other Child 1
---
This child links to [[other_parent.md]].
""")

    other_child2_file = temp_dir / "other_child2.md"
    other_child2_file.write_text("""---
node_id: other_child2
title: Other Child 2
---
This child links to [[other_parent.md]].
""")

    return temp_dir


def test_selective_neighborhood():
    """
    Test that neighborhoods are only included for target nodes.
    """
    # Create temporary directory with test tree
    temp_dir = Path(tempfile.mkdtemp())

    try:
        create_test_tree(temp_dir)

        # Test 1: Traverse to target WITH is_target=True
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=5,
            include_neighborhood=True,
            neighborhood_radius=3
        )

        # Call with is_target=True
        nodes_as_target = traverse_to_node("target.md", temp_dir, options, is_target=True)

        # Extract filenames for easier checking
        filenames_as_target = [node['filename'] for node in nodes_as_target]

        # Should include: root (parent), target, child, sibling1, sibling2 (neighbors)
        assert "root.md" in filenames_as_target, "Should include parent (root)"
        assert "target.md" in filenames_as_target, "Should include target itself"
        assert "child.md" in filenames_as_target, "Should include child"
        assert "sibling1.md" in filenames_as_target, "Should include sibling1 as neighbor"
        assert "sibling2.md" in filenames_as_target, "Should include sibling2 as neighbor"

        # Check that neighbors are properly marked
        for node in nodes_as_target:
            if node['filename'] in ['sibling1.md', 'sibling2.md']:
                assert node.get('neighbor_of_target') == True, f"{node['filename']} should be marked as neighbor_of_target"

        # Check that target is properly marked
        target_node = next(n for n in nodes_as_target if n['filename'] == 'target.md')
        assert target_node.get('is_target') == True, "Target should be marked with is_target=True"

        print("✅ Test 1 passed: Neighborhoods included for target node")

        # Test 2: Traverse to same node WITHOUT is_target flag (or False)
        nodes_not_target = traverse_to_node("target.md", temp_dir, options, is_target=False)

        filenames_not_target = [node['filename'] for node in nodes_not_target]

        # Should include: root (parent), target, child BUT NOT siblings
        assert "root.md" in filenames_not_target, "Should include parent (root)"
        assert "target.md" in filenames_not_target, "Should include target itself"
        assert "child.md" in filenames_not_target, "Should include child"
        assert "sibling1.md" not in filenames_not_target, "Should NOT include sibling1 when not target"
        assert "sibling2.md" not in filenames_not_target, "Should NOT include sibling2 when not target"

        # Check that no nodes are marked as neighbors
        for node in nodes_not_target:
            assert node.get('neighbor_of_target') != True, "No nodes should be marked as neighbor_of_target when is_target=False"

        print("✅ Test 2 passed: No neighborhoods included for non-target node")

        # Test 3: Traverse to other_parent (not a target) to verify no neighborhood
        nodes_other = traverse_to_node("other_parent.md", temp_dir, options, is_target=False)

        filenames_other = [node['filename'] for node in nodes_other]

        # Should include root, other_parent, its children, but NOT its siblings
        assert "root.md" in filenames_other, "Should include root"
        assert "other_parent.md" in filenames_other, "Should include other_parent"
        assert "other_child1.md" in filenames_other, "Should include other_child1"
        assert "other_child2.md" in filenames_other, "Should include other_child2"
        # Should NOT include target or siblings which are at same level
        assert "target.md" not in filenames_other, "Should NOT include target (sibling of other_parent)"

        print("✅ Test 3 passed: Traversal without neighborhoods works correctly")

        # Test 4: Verify max_depth constraint is enforced
        # Create a deeper structure
        deep_child = temp_dir / "deep_child.md"
        deep_child.write_text("""---
node_id: deep_child
title: Deep Child
---
Links to [[child.md]]
""")

        very_deep = temp_dir / "very_deep.md"
        very_deep.write_text("""---
node_id: very_deep
title: Very Deep
---
Links to [[deep_child.md]]
""")

        too_deep = temp_dir / "too_deep.md"
        too_deep.write_text("""---
node_id: too_deep
title: Too Deep
---
Links to [[very_deep.md]]
""")

        # Set max_depth to 3, should not reach too_deep from target
        limited_options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=3,
            include_neighborhood=False
        )

        nodes_limited = traverse_to_node("target.md", temp_dir, limited_options, is_target=False)
        filenames_limited = [node['filename'] for node in nodes_limited]

        assert "root.md" in filenames_limited, "Should include root (depth 1)"
        assert "target.md" in filenames_limited, "Should include target (depth 0)"
        assert "child.md" in filenames_limited, "Should include child (depth 1)"
        assert "deep_child.md" in filenames_limited, "Should include deep_child (depth 2)"
        assert "very_deep.md" in filenames_limited, "Should include very_deep (depth 3)"
        assert "too_deep.md" not in filenames_limited, "Should NOT include too_deep (depth 4, beyond max)"

        print("✅ Test 4 passed: Max depth constraint properly enforced")

        print("\n✅ All tests passed! Selective neighborhood inclusion working correctly.")

    finally:
        # Clean up temp directory
        shutil.rmtree(temp_dir)


if __name__ == "__main__":
    test_selective_neighborhood()
