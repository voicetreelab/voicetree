"""
Unit tests for summary generation in optimizer only
"""

import pytest
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class TestSummaryGeneration:
    """Test that summary generation happens only in optimizer, not during append"""
    
    @pytest.fixture
    def decision_tree(self):
        """Create a decision tree with test nodes"""
        tree = MarkdownTree()
        # Create root node
        tree.create_new_node(
            name="Root",
            parent_node_id=None,
            content="Root content",
            summary="Root summary"
        )
        return tree
    
    def test_append_content_no_summary_update(self):
        """Test that append_node_content doesn't update summary"""
        tree = MarkdownTree()
        node_id = tree.create_new_node(
            name="Test Node",
            parent_node_id=None,
            content="Original content",
            summary="Original summary"
        )
        
        # append_node_content should not change summary
        tree.append_node_content(node_id, "New content", transcript="chunk1")
        
        node = tree.tree[node_id]
        # Summary should remain unchanged
        assert node.summary == "Original summary"
        # Content should be appended
        assert "New content" in node.content
    
    def test_update_node_changes_summary(self):
        """Test that update_node (used by optimizer) changes the summary"""
        tree = MarkdownTree()
        node_id = tree.create_new_node(
            name="Test",
            parent_node_id=None,
            content="Original content",
            summary="Original summary"
        )
        
        # update_node should change both content and summary
        tree.update_node(
            node_id=node_id,
            content="Updated content",
            summary="Updated summary from optimizer"
        )
        
        node = tree.tree[node_id]
        assert node.content == "Updated content"
        assert node.summary == "Updated summary from optimizer"
    
    def test_append_preserves_summary_until_optimization(self):
        """Test workflow: append doesn't change summary, optimization does"""
        tree = MarkdownTree()
        node_id = tree.create_new_node(
            name="Workflow Test",
            parent_node_id=None,
            content="Initial content",
            summary="Initial summary"
        )
        
        # Step 1: Append new content (simulating stage 3)
        tree.append_node_content(node_id, "Appended chunk 1", transcript="chunk1")
        tree.append_node_content(node_id, "Appended chunk 2", transcript="chunk2")
        
        node = tree.tree[node_id]
        
        # Summary should NOT change during appends
        assert node.summary == "Initial summary"
        assert "Appended chunk 1" in node.content
        assert "Appended chunk 2" in node.content
        
        # Step 2: Optimization updates the node (simulating stage 4)
        tree.update_node(
            node_id=node_id,
            content="Optimized content combining all chunks",
            summary="New summary after optimization"
        )
        
        # Now summary should be updated
        assert node.summary == "New summary after optimization"
        assert node.content == "Optimized content combining all chunks"
    
    def test_append_node_content_method_signature(self):
        """Test that DecisionTree.append_node_content has the correct signature"""
        import inspect
        sig = inspect.signature(MarkdownTree.append_node_content)
        
        # Check that the method has the expected parameters
        params = list(sig.parameters.keys())
        assert "self" in params
        assert "node_id" in params
        assert "new_content" in params
        assert "transcript" in params
        # Should NOT have a summary parameter - appending doesn't change summary


if __name__ == "__main__":
    pytest.main([__file__, "-v"])