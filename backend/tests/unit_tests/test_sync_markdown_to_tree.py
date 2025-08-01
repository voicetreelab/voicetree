import os
import tempfile
import shutil
from datetime import datetime
import pytest

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager.sync_markdown_to_tree import (
    MarkdownToTreeSynchronizer,
    sync_nodes_from_markdown
)


class TestMarkdownToTreeSync:
    """Test synchronization of markdown content back to tree nodes"""
    
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for test markdown files"""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def decision_tree(self, temp_dir):
        """Create a decision tree with test nodes"""
        tree = DecisionTree(output_dir=temp_dir)
        
        # Create a test node
        node_id = tree.create_new_node(
            name="Test Node",
            parent_node_id=None,
            content="Original content",
            summary="Original summary",
            relationship_to_parent=""
        )
        
        return tree
    
    def test_sync_node_from_markdown_with_changes(self, decision_tree, temp_dir):
        """Test syncing a node when markdown has been manually edited"""
        # Get the node
        node_id = 1
        node = decision_tree.tree[node_id]
        original_content = node.content
        original_summary = node.summary
        
        # Manually edit the markdown file
        markdown_path = os.path.join(temp_dir, node.filename)
        
        # Read current markdown
        with open(markdown_path, 'r') as f:
            content = f.read()
        
        # Modify the content
        new_content = content.replace("Original content", "Manually edited content")
        new_content = new_content.replace("Original summary", "Manually edited summary")
        
        # Write back
        with open(markdown_path, 'w') as f:
            f.write(new_content)
        
        # Create synchronizer and sync
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        result = synchronizer.sync_node_from_markdown(node_id)
        
        # Verify sync was successful
        assert result is True
        
        # Verify node was updated
        assert node.content == "Manually edited content"
        assert node.summary == "Manually edited summary"
        assert node.content != original_content
        assert node.summary != original_summary
    
    def test_sync_node_from_markdown_no_changes(self, decision_tree, temp_dir):
        """Test syncing when markdown hasn't changed"""
        node_id = 1
        node = decision_tree.tree[node_id]
        original_content = node.content
        original_summary = node.summary
        original_modified = node.modified_at
        
        # Sync without any changes
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        result = synchronizer.sync_node_from_markdown(node_id)
        
        # Verify sync was successful
        assert result is True
        
        # Verify content unchanged
        assert node.content == original_content
        assert node.summary == original_summary
    
    def test_sync_nonexistent_node(self, decision_tree):
        """Test syncing a node that doesn't exist"""
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        result = synchronizer.sync_node_from_markdown(999)
        
        assert result is False
    
    def test_sync_node_missing_markdown_file(self, decision_tree, temp_dir):
        """Test syncing when markdown file is missing"""
        node_id = 1
        node = decision_tree.tree[node_id]
        
        # Delete the markdown file
        markdown_path = os.path.join(temp_dir, node.filename)
        os.remove(markdown_path)
        
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        result = synchronizer.sync_node_from_markdown(node_id)
        
        assert result is False
    
    def test_sync_multiple_nodes(self, decision_tree, temp_dir):
        """Test syncing multiple nodes at once"""
        # Create additional nodes
        node2_id = decision_tree.create_new_node(
            name="Test Node 2",
            parent_node_id=None,
            content="Original content 2",
            summary="Original summary 2",
            relationship_to_parent=""
        )
        
        node3_id = decision_tree.create_new_node(
            name="Test Node 3",
            parent_node_id=None,
            content="Original content 3",
            summary="Original summary 3",
            relationship_to_parent=""
        )
        
        # Manually edit node 1 and node 3 markdown files
        for node_id in [1, node3_id]:
            node = decision_tree.tree[node_id]
            markdown_path = os.path.join(temp_dir, node.filename)
            
            with open(markdown_path, 'r') as f:
                content = f.read()
            
            content = content.replace("Original", "Edited")
            
            with open(markdown_path, 'w') as f:
                f.write(content)
        
        # Sync all nodes
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        synced_count = synchronizer.sync_nodes_before_update({1, node2_id, node3_id})
        
        # Verify sync count
        assert synced_count == 3
        
        # Verify correct nodes were updated
        assert "Edited" in decision_tree.tree[1].content
        assert "Original" in decision_tree.tree[node2_id].content  # Not edited
        assert "Edited" in decision_tree.tree[node3_id].content
    
    def test_sync_nodes_from_markdown_convenience_function(self, decision_tree, temp_dir):
        """Test the convenience function"""
        node_id = 1
        node = decision_tree.tree[node_id]
        
        # Edit markdown
        markdown_path = os.path.join(temp_dir, node.filename)
        with open(markdown_path, 'r') as f:
            content = f.read()
        
        content = content.replace("Original content", "Updated via convenience function")
        
        with open(markdown_path, 'w') as f:
            f.write(content)
        
        # Use convenience function
        synced_count = sync_nodes_from_markdown(decision_tree, {node_id})
        
        assert synced_count == 1
        assert node.content == "Updated via convenience function"
    
    def test_sync_preserves_metadata(self, decision_tree, temp_dir):
        """Test that sync only updates content/summary, preserves other metadata"""
        node_id = 1
        node = decision_tree.tree[node_id]
        
        # Set some metadata
        node.tags = ["test", "metadata"]
        node.num_appends = 5
        original_created_at = node.created_at
        original_parent_id = node.parent_id
        original_children = node.children.copy()
        
        # Edit markdown
        markdown_path = os.path.join(temp_dir, node.filename)
        with open(markdown_path, 'r') as f:
            content = f.read()
        
        content = content.replace("Original content", "New content")
        
        with open(markdown_path, 'w') as f:
            f.write(content)
        
        # Sync
        synchronizer = MarkdownToTreeSynchronizer(decision_tree)
        synchronizer.sync_node_from_markdown(node_id)
        
        # Verify only content changed, metadata preserved
        assert node.content == "New content"
        assert node.tags == ["test", "metadata"]
        assert node.num_appends == 5
        assert node.created_at == original_created_at
        assert node.parent_id == original_parent_id
        assert node.children == original_children