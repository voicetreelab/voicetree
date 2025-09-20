"""
Test UPDATE action support for TreeActionApplier
Following TDD approach - write tests first, then implementation
"""

import pytest
from unittest.mock import Mock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction


class TestTreeActionApplierUpdate:
    
    @pytest.fixture
    def mock_decision_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {}
        tree.get_node_id_from_name = Mock()
        tree.create_new_node = Mock()
        tree.update_node = Mock()  # New method we're testing
        return tree
    
    @pytest.fixture
    def applier(self, mock_decision_tree):
        """Create a TreeActionApplier instance"""
        return TreeActionApplier(mock_decision_tree)
    
    def test_apply_update_action(self, applier, mock_decision_tree):
        """Test applying an UPDATE action to modify node content/summary"""
        # Setup
        node_id = 5
        
        update_action = UpdateAction(
            action="UPDATE",
            node_id=node_id,
            new_content="Updated content for the node",
            new_summary="Updated concise summary"
        )
        
        # Execute - TreeActionApplier needs to handle UpdateAction
        updated_nodes = applier.apply([update_action])
        
        # Verify
        mock_decision_tree.update_node.assert_called_once_with(
            node_id=node_id,
            content="Updated content for the node",
            summary="Updated concise summary"
        )
        assert updated_nodes == {node_id}
    
    def test_apply_split_as_update_plus_creates(self, applier, mock_decision_tree):
        """Test SPLIT operation as UPDATE + CREATE actions"""
        # Setup
        parent_node_id = 10
        mock_decision_tree.get_node_id_from_name.side_effect = lambda name: {
            "Parent Node": parent_node_id,
            "Child B": None,  # Doesn't exist yet
            "Child C": None   # Doesn't exist yet
        }.get(name)
        mock_decision_tree.create_new_node.side_effect = [20, 21]  # New node IDs
        
        # Actions that represent a SPLIT: UPDATE parent + CREATE children
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=parent_node_id,
                new_content="Parent content only",
                new_summary="Parent node summary"
            ),
            CreateAction(
                action="CREATE",
                target_node_name="Parent Node",
                new_node_name="Child B",
                content="Content for child B",
                summary="Child B summary",
                relationship="subtask of"
            ),
            CreateAction(
                action="CREATE",
                target_node_name="Parent Node",
                new_node_name="Child C",
                content="Content for child C",
                summary="Child C summary",
                relationship="subtask of"
            )
        ]
        
        # Execute - need unified method to handle both action types
        updated_nodes = applier.apply(actions)
        
        # Verify
        # Should update parent
        mock_decision_tree.update_node.assert_called_once_with(
            node_id=parent_node_id,
            content="Parent content only",
            summary="Parent node summary"
        )
        
        # Should create two children
        assert mock_decision_tree.create_new_node.call_count == 2
        mock_decision_tree.create_new_node.assert_any_call(
            name="Child B",
            parent_node_id=parent_node_id,
            content="Content for child B",
            summary="Child B summary",
            relationship_to_parent="subtask of"
        )
        mock_decision_tree.create_new_node.assert_any_call(
            name="Child C",
            parent_node_id=parent_node_id,
            content="Content for child C",
            summary="Child C summary",
            relationship_to_parent="subtask of"
        )
        
        # Should track all updated nodes
        assert updated_nodes == {parent_node_id, 20, 21}
    
    def test_apply_multiple_update_actions(self, applier, mock_decision_tree):
        """Test applying multiple UPDATE actions"""
        # Setup
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="Updated content 1",
                new_summary="Updated summary 1"
            ),
            UpdateAction(
                action="UPDATE",
                node_id=2,
                new_content="Updated content 2",
                new_summary="Updated summary 2"
            )
        ]
        
        # Execute
        updated_nodes = applier.apply(actions)
        
        # Verify
        assert mock_decision_tree.update_node.call_count == 2
        mock_decision_tree.update_node.assert_any_call(
            node_id=1,
            content="Updated content 1",
            summary="Updated summary 1"
        )
        mock_decision_tree.update_node.assert_any_call(
            node_id=2,
            content="Updated content 2",
            summary="Updated summary 2"
        )
        assert updated_nodes == {1, 2}
    
    def test_empty_actions_list(self, applier, mock_decision_tree):
        """Test handling empty actions list (no optimization needed)"""
        # Execute
        updated_nodes = applier.apply([])
        
        # Verify
        mock_decision_tree.update_node.assert_not_called()
        mock_decision_tree.create_new_node.assert_not_called()
        assert updated_nodes == set()