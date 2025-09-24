"""
Unit tests for unified action model in TreeActionApplier
"""

from unittest.mock import Mock

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)


class TestUnifiedActionModel:
    """Test unified action handling in TreeActionApplier"""

    @pytest.fixture
    def mock_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {
            1: Mock(id=1, title="Root", content="Root content"),
            2: Mock(id=2, title="Child", content="Child content")
        }
        tree.create_new_node = Mock(return_value=3)
        tree.update_node = Mock()
        return tree

    @pytest.fixture
    def applier(self, mock_tree):
        """Create TreeActionApplier instance"""
        return TreeActionApplier(mock_tree)

    def test_apply_single_method_handles_all_actions(self, applier, mock_tree):
        """Test that a single apply() method can handle all action types"""
        # Mix of different action types
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="Updated root content",
                new_summary="Updated root summary"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=1,
                new_node_name="New Child",
                content="New child content",
                summary="New child summary",
                relationship="subtopic of"
            ),
            UpdateAction(
                action="UPDATE",
                node_id=2,
                new_content="Updated child content",
                new_summary="Updated child summary"
            )
        ]

        # Apply all actions through single method
        updated_nodes = applier.apply(actions)

        # Verify all actions were applied
        assert mock_tree.update_node.call_count == 2
        assert mock_tree.create_new_node.call_count == 1

        # Verify correct nodes were updated
        assert 1 in updated_nodes  # Updated root
        assert 2 in updated_nodes  # Updated child
        assert 3 in updated_nodes  # New node

    def test_apply_handles_empty_list(self, applier):
        """Test apply() with empty action list"""
        updated_nodes = applier.apply([])
        assert updated_nodes == set()

    def test_apply_validates_action_types(self, applier):
        """Test that apply() validates action types"""
        # Create an invalid action (mock object)
        invalid_action = Mock()
        invalid_action.action = "INVALID"

        with pytest.raises(ValueError, match="Unknown action type"):
            applier.apply([invalid_action])

    def test_apply_with_append_actions(self, applier, mock_tree):
        """Test unified handling includes APPEND actions"""
        # For new pipeline, APPEND is represented as a special UPDATE
        # where we append to existing content instead of replacing
        append_action = UpdateAction(
            action="UPDATE",
            node_id=2,
            new_content="Original content\n\nAppended content",
            new_summary="Updated summary with appended info"
        )

        updated_nodes = applier.apply([append_action])

        mock_tree.update_node.assert_called_once_with(
            node_id=2,
            content="Original content\n\nAppended content",
            summary="Updated summary with appended info"
        )
        assert 2 in updated_nodes

    def test_base_action_inheritance(self):
        """Test that all action types inherit from BaseTreeAction"""
        from backend.text_to_graph_pipeline.agentic_workflows.models import (
            BaseTreeAction,
        )

        # All action types should inherit from BaseTreeAction
        assert issubclass(UpdateAction, BaseTreeAction)
        assert issubclass(CreateAction, BaseTreeAction)

    def test_action_type_discrimination(self):
        """Test that actions can be discriminated by their type field"""
        update = UpdateAction(
            action="UPDATE",
            node_id=1,
            new_content="content",
            new_summary="summary"
        )
        create = CreateAction(
            action="CREATE",
            parent_node_id=1,
            new_node_name="name",
            content="content",
            summary="summary",
            relationship="relation"
        )

        assert update.action == "UPDATE"
        assert create.action == "CREATE"

        # Type field should be literal/constant
        from typing import Literal
        assert UpdateAction.model_fields['action'].annotation == Literal["UPDATE"]
        assert CreateAction.model_fields['action'].annotation == Literal["CREATE"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
