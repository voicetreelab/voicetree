"""
Unit tests for TreeActionApplier with node ID support
"""

import pytest
from unittest.mock import Mock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    IntegrationDecision, UpdateAction, CreateAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


class TestTreeActionApplierWithNodeIDs:
    """Test TreeActionApplier working directly with node IDs"""
    
    @pytest.fixture
    def mock_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {
            1: Mock(id=1, title="Root", content="Root content"),
            2: Mock(id=2, title="Child", content="Child content")
        }
        tree.get_node_id_from_name = Mock()  # Should not be called
        tree.create_new_node = Mock(return_value=3)
        return tree
    
    @pytest.fixture
    def applier(self, mock_tree):
        """Create TreeActionApplier instance"""
        return TreeActionApplier(mock_tree)
    
    def test_append_with_node_id(self, applier, mock_tree):
        """Test appending content using node ID directly"""
        # Create an append decision with target_node_id
        decision = IntegrationDecision(
            name="Segment 1",
            text="New content to append",
            reasoning="This relates to the child node",
            action="APPEND",
            target_node_id=2,  # Using ID directly
            content="New content to append"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node ID was used directly
        mock_tree.get_node_id_from_name.assert_not_called()
        
        # Verify content was appended to the correct node
        node = mock_tree.tree[2]
        node.append_content.assert_called_once_with(
            "New content to append",
            None,
            "Segment 1"
        )
        
        # Verify updated nodes set
        assert 2 in updated_nodes
    
    def test_create_with_parent_node_id(self, applier, mock_tree):
        """Test creating new node with parent ID"""
        # Create decision with parent_node_id
        decision = IntegrationDecision(
            name="New Segment",
            text="Content for new node",
            reasoning="This is a new concept",
            action="CREATE",
            parent_node_id=1,  # Parent ID
            new_node_name="New Concept",
            new_node_summary="A new concept node",
            relationship_for_edge="subtopic of",
            content="Content for new node"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node was created with parent ID
        mock_tree.get_node_id_from_name.assert_not_called()
        mock_tree.create_new_node.assert_called_once_with(
            name="New Concept",
            parent_node_id=1,
            content="Content for new node",
            summary="A new concept node",
            relationship_to_parent="subtopic of"
        )
        
        # Verify updated nodes
        assert 3 in updated_nodes  # New node
        assert 1 in updated_nodes  # Parent node
    
    def test_update_action_with_node_id(self, applier, mock_tree):
        """Test UPDATE action uses node ID directly"""
        # Setup update_node method
        mock_tree.update_node = Mock()
        
        # Create update action
        action = UpdateAction(
            action="UPDATE",
            node_id=2,
            new_content="Updated content",
            new_summary="Updated summary"
        )
        
        # Apply the action
        updated_nodes = applier.apply([action])
        
        # Verify update was called with ID
        mock_tree.update_node.assert_called_once_with(
            node_id=2,
            content="Updated content",
            summary="Updated summary"
        )
        
        assert 2 in updated_nodes
    
    def test_create_action_for_new_node_no_parent(self, applier, mock_tree):
        """Test creating root-level node when parent_node_id is -1"""
        decision = IntegrationDecision(
            name="Root Level Node",
            text="New root content",
            reasoning="New top-level concept",
            action="CREATE",
            parent_node_id=-1,  # Special value for no parent
            new_node_name="New Root",
            new_node_summary="A new root node",
            content="New root content"
        )
        
        # Apply the decision
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify node was created without parent
        mock_tree.create_new_node.assert_called_once_with(
            name="New Root",
            parent_node_id=None,  # -1 converted to None
            content="New root content",
            summary="A new root node",
            relationship_to_parent=None
        )
        
        assert 3 in updated_nodes


if __name__ == "__main__":
    pytest.main([__file__, "-v"])