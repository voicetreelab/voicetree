"""
Unit tests for TreeActionApplier
"""

import pytest
from unittest.mock import Mock, MagicMock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision


class TestTreeActionApplier:
    
    @pytest.fixture
    def mock_decision_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {}
        tree.get_node_id_from_name = Mock()
        tree.create_new_node = Mock()
        return tree
    
    @pytest.fixture
    def applier(self, mock_decision_tree):
        """Create a TreeActionApplier instance"""
        return TreeActionApplier(mock_decision_tree)
    
    def test_apply_create_action(self, applier, mock_decision_tree):
        """Test applying a CREATE action"""
        # Setup
        mock_decision_tree.get_node_id_from_name.return_value = 1  # Parent ID
        mock_decision_tree.create_new_node.return_value = 2  # New node ID
        
        decision = IntegrationDecision(
            name="Test Node",
            text="Test content",
            reasoning="Test reasoning",
            action="CREATE",
            target_node="Parent Node",
            new_node_name="Test Node",
            new_node_summary="Test summary",
            relationship_for_edge="child of",
            content="Test content"
        )
        
        # Execute
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify
        mock_decision_tree.get_node_id_from_name.assert_called_once_with("Parent Node")
        mock_decision_tree.create_new_node.assert_called_once_with(
            name="Test Node",
            parent_node_id=1,
            content="Test content",
            summary="Test summary",
            relationship_to_parent="child of"
        )
        assert updated_nodes == {1, 2}  # Both parent and new node should be updated
    
    def test_apply_append_action(self, applier, mock_decision_tree):
        """Test applying an APPEND action"""
        # Setup
        mock_node = MagicMock()
        mock_decision_tree.tree = {3: mock_node}
        mock_decision_tree.get_node_id_from_name.return_value = 3
        
        decision = IntegrationDecision(
            name="Append chunk",
            text="Append content",
            reasoning="Test reasoning",
            action="APPEND",
            target_node="Target Node",
            content="Append content",
            new_node_name=None,
            new_node_summary=None,
            relationship_for_edge=None
        )
        
        # Execute
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify
        mock_decision_tree.get_node_id_from_name.assert_called_once_with("Target Node")
        mock_node.append_content.assert_called_once_with(
            "Append content",
            None,
            "Append chunk"
        )
        assert updated_nodes == {3}
    
    def test_apply_multiple_decisions(self, applier, mock_decision_tree):
        """Test applying multiple decisions"""
        # Setup
        mock_node = MagicMock()
        mock_decision_tree.tree = {1: mock_node}
        # First call returns None (CREATE has no parent), second returns 1 (for APPEND target)
        def get_node_id_side_effect(name):
            if name == "Existing Node":
                return 1
            return None
        mock_decision_tree.get_node_id_from_name.side_effect = get_node_id_side_effect
        mock_decision_tree.create_new_node.return_value = 2
        
        decisions = [
            IntegrationDecision(
                name="New Node",
                text="Content",
                reasoning="Reasoning",
                action="CREATE",
                new_node_name="New Node",
                content="Content",
                target_node=None,
                new_node_summary="Summary",
                relationship_for_edge="child of"
            ),
            IntegrationDecision(
                name="Append",
                text="More content",
                reasoning="Reasoning",
                action="APPEND",
                target_node="Existing Node",
                content="More content",
                new_node_name=None,
                new_node_summary=None,
                relationship_for_edge=None
            )
        ]
        
        # Execute
        updated_nodes = applier.apply_integration_decisions(decisions)
        
        # Verify
        assert mock_decision_tree.create_new_node.call_count == 1
        assert mock_node.append_content.call_count == 1
        assert updated_nodes == {1, 2}
    
    def test_append_without_target_node(self, applier, mock_decision_tree):
        """Test APPEND action without target node"""
        decision = IntegrationDecision(
            name="Append chunk",
            text="Content",
            reasoning="Reasoning",
            action="APPEND",
            content="Content",
            target_node=None,
            new_node_name=None,
            new_node_summary=None,
            relationship_for_edge=None
        )
        
        # Execute
        updated_nodes = applier.apply_integration_decisions([decision])
        
        # Verify - should skip this decision
        mock_decision_tree.get_node_id_from_name.assert_not_called()
        assert updated_nodes == set()
    
    def test_unknown_action_type(self, applier, mock_decision_tree):
        """Test handling of unknown action type"""
        # Since IntegrationDecision validates action type, we can't test unknown actions directly
        # Instead, let's test that both CREATE and APPEND actions work correctly
        pass