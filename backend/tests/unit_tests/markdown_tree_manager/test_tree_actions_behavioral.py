"""
Behavioral tests for tree actions with ID-only operations
Tests the complete flow: AppendAction, CreateAction, UpdateAction through unified apply()
"""

from unittest.mock import MagicMock
from unittest.mock import Mock

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)


class TestTreeActionsBehavioral:
    """Behavioral tests for tree actions - input/output focused"""
    
    @pytest.fixture
    def mock_tree(self):
        """Create a mock decision tree with realistic nodes"""
        tree = Mock()
        
        # Create mock nodes with realistic structure
        root_node = MagicMock()
        root_node.id = 1
        root_node.title = "Project Overview"
        root_node.content = "This project aims to build a voice-to-tree system."
        
        child_node = MagicMock()
        child_node.id = 2
        child_node.title = "Technical Requirements"
        child_node.content = "The system needs to process audio input."
        
        tree.tree = {
            1: root_node,
            2: child_node
        }
        
        tree.create_new_node = Mock(return_value=3)
        tree.update_node = Mock()
        tree.append_node_content = Mock()
        
        return tree
    
    @pytest.fixture
    def applier(self, mock_tree):
        """Create TreeActionApplier instance"""
        return TreeActionApplier(mock_tree)
    
    def test_complete_workflow_append_create_update(self, applier, mock_tree):
        """Test realistic workflow: append to existing, create new, update existing"""
        # Simulate AppendToRelevantNodeAgent output
        actions = [
            # Append new information to existing node
            AppendAction(
                action="APPEND",
                target_node_id=2,
                content="Additionally, we need real-time processing capabilities."
            ),
            # Create a new node for unrelated content
            CreateAction(
                action="CREATE",
                parent_node_id=1,
                new_node_name="Security Considerations",
                content="The system must ensure data privacy and encryption.",
                summary="Security requirements for the voice system",
                relationship="aspect of"
            ),
            # Update existing node (from optimizer)
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="This project aims to build a voice-to-tree system that converts speech into structured knowledge graphs.",
                new_summary="Voice-to-tree system for knowledge graph generation"
            )
        ]
        
        # Apply all actions
        updated_nodes = applier.apply(actions)
        
        # Verify append action
        mock_tree.append_node_content.assert_called_once_with(
            2, "Additionally, we need real-time processing capabilities."
        )
        
        # Verify create action
        mock_tree.create_new_node.assert_called_once_with(
            name="Security Considerations",
            parent_node_id=1,
            content="The system must ensure data privacy and encryption.",
            summary="Security requirements for the voice system",
            relationship_to_parent="aspect of"
        )
        
        # Verify update action
        mock_tree.update_node.assert_called_once_with(
            node_id=1,
            content="This project aims to build a voice-to-tree system that converts speech into structured knowledge graphs.",
            summary="Voice-to-tree system for knowledge graph generation"
        )
        
        # Verify all affected nodes are in the result
        assert updated_nodes == {1, 2, 3}
    
    def test_id_only_operations_no_name_fallback(self, applier, mock_tree):
        """Test that system uses IDs only, with no name-based fallback"""
        # Test 1: Invalid node ID for append should fail gracefully
        append_to_nonexistent = AppendAction(
            action="APPEND",
            target_node_id=999,  # Doesn't exist
            content="This should not be appended"
        )
        
        updated_nodes = applier.apply([append_to_nonexistent])
        
        # Should not crash, but also should not append anything
        assert updated_nodes == set()
        mock_tree.append_node_content.assert_not_called()
        
        # Test 2: Create with specific parent ID
        create_with_parent = CreateAction(
            action="CREATE",
            parent_node_id=2,  # Specific parent by ID
            new_node_name="Implementation Details",
            content="We will use Python and LangGraph",
            summary="Technical implementation details",
            relationship="elaborates on"
        )
        
        updated_nodes = applier.apply([create_with_parent])
        
        mock_tree.create_new_node.assert_called_with(
            name="Implementation Details",
            parent_node_id=2,  # Must use exact ID
            content="We will use Python and LangGraph",
            summary="Technical implementation details",
            relationship_to_parent="elaborates on"
        )
        
        # Should update parent node and new node
        assert 2 in updated_nodes
        assert 3 in updated_nodes
    
    def test_empty_and_edge_cases(self, applier, mock_tree):
        """Test edge cases and empty inputs"""
        # Empty action list
        assert applier.apply([]) == set()
        
        # Single action
        single_action = AppendAction(
            action="APPEND",
            target_node_id=1,
            content="A single append."
        )
        updated = applier.apply([single_action])
        assert updated == {1}
        
        # Reset the mock before the next test
        mock_tree.append_node_content.reset_mock()
        
        # Many actions to same node
        multiple_appends = [
            AppendAction(action="APPEND", target_node_id=2, content="First append."),
            AppendAction(action="APPEND", target_node_id=2, content="Second append."),
            AppendAction(action="APPEND", target_node_id=2, content="Third append.")
        ]
        updated = applier.apply(multiple_appends)
        assert updated == {2}
        assert mock_tree.append_node_content.call_count == 3
    
    def test_unknown_action_type_raises_error(self, applier):
        """Test that unknown action types raise appropriate errors"""
        # Create a mock action with invalid type
        invalid_action = Mock()
        invalid_action.action = "DELETE"  # Not supported
        
        with pytest.raises(ValueError, match="Unknown action type: DELETE"):
            applier.apply([invalid_action])
    
    def test_append_action_inheritance_and_fields(self):
        """Test AppendAction structure and inheritance"""
        from backend.text_to_graph_pipeline.agentic_workflows.models import (
            BaseTreeAction,
        )
        
        # Verify inheritance
        assert issubclass(AppendAction, BaseTreeAction)
        
        # Verify fields
        append = AppendAction(
            action="APPEND",
            target_node_id=42,
            content="Test content"
        )
        
        assert append.action == "APPEND"
        assert append.target_node_id == 42
        assert append.content == "Test content"
        
        # Verify literal type
        from typing import Literal
        assert AppendAction.model_fields['action'].annotation == Literal["APPEND"]