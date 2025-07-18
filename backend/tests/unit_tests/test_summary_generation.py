"""
Unit tests for summary generation in optimizer only
"""

import pytest
from unittest.mock import Mock, call
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node, DecisionTree


class TestSummaryGeneration:
    """Test that summary generation happens only in optimizer, not during append"""
    
    @pytest.fixture
    def decision_tree(self):
        """Create a decision tree with test nodes"""
        tree = DecisionTree()
        # Create root node
        tree.create_new_node(
            name="Root",
            parent_node_id=None,
            content="Root content",
            summary="Root summary"
        )
        return tree
    
    def test_append_content_no_summary_update(self):
        """Test that append_content doesn't update summary when None is passed"""
        node = Node(
            name="Test Node",
            node_id=1,
            content="Original content",
            summary="Original summary"
        )
        
        # append_content should not change summary when None is passed
        node.append_content("New content", transcript="chunk1")
        
        # Summary should remain unchanged when None is passed
        assert node.summary == "Original summary"
        # Content should be appended
        assert "New content" in node.content
    
    def test_update_node_changes_summary(self):
        """Test that update_node (used by optimizer) changes the summary"""
        tree = DecisionTree()
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
        tree = DecisionTree()
        node_id = tree.create_new_node(
            name="Workflow Test",
            parent_node_id=None,
            content="Initial content",
            summary="Initial summary"
        )
        
        node = tree.tree[node_id]
        
        # Step 1: Append new content (simulating stage 3)
        node.append_content("Appended chunk 1", summary=None, transcript="chunk1")
        node.append_content("Appended chunk 2", summary=None, transcript="chunk2")
        
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
    
    def test_node_append_method_should_not_update_summary(self):
        """Test that Node.append_content should not update summary"""
        import inspect
        sig = inspect.signature(Node.append_content)
        
        # Current signature has summary, but we want to remove it
        params = list(sig.parameters.keys())
        assert "self" in params
        assert "new_content" in params
        assert "transcript" in params
        # TODO: Remove summary parameter from append_content
        # This test documents that we currently have summary but shouldn't


if __name__ == "__main__":
    pytest.main([__file__, "-v"])