"""
Tests for node removal and deletion detection functionality
"""

import os
import tempfile
import pytest
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.sync_markdown_to_tree import MarkdownToTreeSynchronizer


class TestNodeRemoval:
    """Test suite for node removal functionality"""

    @pytest.fixture
    def temp_tree(self):
        """Create a MarkdownTree with a temporary directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            tree = MarkdownTree(output_dir=temp_dir, embedding_manager=False)
            yield tree, temp_dir

    def test_remove_node_basic(self, temp_tree):
        """Test basic node removal"""
        tree, temp_dir = temp_tree

        # Create a test node
        node_id = tree.create_new_node(
            name="Test Node",
            parent_node_id=None,
            content="Test content",
            summary="Test summary"
        )

        # Verify node exists
        assert node_id in tree.tree
        node = tree.tree[node_id]
        markdown_path = os.path.join(temp_dir, node.filename)
        assert os.path.exists(markdown_path)

        # Remove node
        result = tree.remove_node(node_id)

        # Verify removal
        assert result is True
        assert node_id not in tree.tree
        assert not os.path.exists(markdown_path)

    def test_remove_nonexistent_node(self, temp_tree):
        """Test removing a node that doesn't exist"""
        tree, _ = temp_tree

        result = tree.remove_node(9999)
        assert result is False

    def test_remove_node_with_parent(self, temp_tree):
        """Test removing a node that has a parent"""
        tree, temp_dir = temp_tree

        # Create parent and child
        parent_id = tree.create_new_node(
            name="Parent",
            parent_node_id=None,
            content="Parent content",
            summary="Parent summary"
        )

        child_id = tree.create_new_node(
            name="Child",
            parent_node_id=parent_id,
            content="Child content",
            summary="Child summary"
        )

        # Verify relationship
        assert child_id in tree.tree[parent_id].children

        # Remove child
        tree.remove_node(child_id)

        # Verify parent's children list updated
        assert child_id not in tree.tree[parent_id].children
        assert child_id not in tree.tree

    def test_remove_node_with_children(self, temp_tree):
        """Test removing a node that has children"""
        tree, _ = temp_tree

        # Create parent with children
        parent_id = tree.create_new_node(
            name="Parent",
            parent_node_id=None,
            content="Parent content",
            summary="Parent summary"
        )

        child1_id = tree.create_new_node(
            name="Child 1",
            parent_node_id=parent_id,
            content="Child 1 content",
            summary="Child 1 summary"
        )

        child2_id = tree.create_new_node(
            name="Child 2",
            parent_node_id=parent_id,
            content="Child 2 content",
            summary="Child 2 summary"
        )

        # Remove parent
        tree.remove_node(parent_id)

        # Verify parent removed
        assert parent_id not in tree.tree

        # Verify children now have no parent (become orphans)
        assert tree.tree[child1_id].parent_id is None
        assert tree.tree[child2_id].parent_id is None

    def test_detect_and_remove_deleted_nodes(self, temp_tree):
        """Test detection and removal of nodes with missing markdown files"""
        tree, temp_dir = temp_tree

        # Create test nodes
        node1_id = tree.create_new_node(
            name="Node 1",
            parent_node_id=None,
            content="Content 1",
            summary="Summary 1"
        )

        node2_id = tree.create_new_node(
            name="Node 2",
            parent_node_id=None,
            content="Content 2",
            summary="Summary 2"
        )

        node3_id = tree.create_new_node(
            name="Node 3",
            parent_node_id=None,
            content="Content 3",
            summary="Summary 3"
        )

        # Manually delete markdown files for nodes 1 and 2
        node1 = tree.tree[node1_id]
        node2 = tree.tree[node2_id]
        os.unlink(os.path.join(temp_dir, node1.filename))
        os.unlink(os.path.join(temp_dir, node2.filename))

        # Use synchronizer to detect and remove
        synchronizer = MarkdownToTreeSynchronizer(tree)
        removed_count = synchronizer.detect_and_remove_deleted_nodes()

        # Verify correct nodes removed
        assert removed_count == 2
        assert node1_id not in tree.tree
        assert node2_id not in tree.tree
        assert node3_id in tree.tree  # Node 3 should still exist

    def test_sync_with_cleanup(self, temp_tree):
        """Test combined sync and cleanup operation"""
        tree, temp_dir = temp_tree

        # Create test nodes
        node1_id = tree.create_new_node(
            name="Node 1",
            parent_node_id=None,
            content="Original content",
            summary="Original summary"
        )

        node2_id = tree.create_new_node(
            name="Node 2",
            parent_node_id=None,
            content="Content 2",
            summary="Summary 2"
        )

        # Modify node 1's markdown file
        node1 = tree.tree[node1_id]
        markdown_path1 = os.path.join(temp_dir, node1.filename)
        with open(markdown_path1, 'r') as f:
            content = f.read()
        modified_content = content.replace("Original content", "Modified content")
        with open(markdown_path1, 'w') as f:
            f.write(modified_content)

        # Delete node 2's markdown file
        node2 = tree.tree[node2_id]
        os.unlink(os.path.join(temp_dir, node2.filename))

        # Run sync with cleanup
        synchronizer = MarkdownToTreeSynchronizer(tree)
        synced_count, removed_count = synchronizer.sync_nodes_before_update_with_cleanup({node1_id, node2_id})

        # Verify results
        assert synced_count == 1  # Node 1 synced
        assert removed_count == 1  # Node 2 removed
        assert "Modified content" in tree.tree[node1_id].content
        assert node2_id not in tree.tree

    def test_remove_node_with_missing_markdown_file(self, temp_tree):
        """Test removing a node when its markdown file is already missing"""
        tree, temp_dir = temp_tree

        # Create a test node
        node_id = tree.create_new_node(
            name="Test Node",
            parent_node_id=None,
            content="Test content",
            summary="Test summary"
        )

        # Manually delete the markdown file
        node = tree.tree[node_id]
        markdown_path = os.path.join(temp_dir, node.filename)
        os.unlink(markdown_path)

        # Remove node (should not crash even though file is missing)
        result = tree.remove_node(node_id)

        # Verify removal succeeded
        assert result is True
        assert node_id not in tree.tree