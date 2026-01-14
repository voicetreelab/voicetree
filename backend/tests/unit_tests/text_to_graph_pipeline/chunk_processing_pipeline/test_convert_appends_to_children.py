"""
Test _convert_appends_to_children_for_long_nodes functionality
Following TDD approach - tests for converting AppendActions to CreateActions when target nodes exceed length limit
"""

from unittest.mock import Mock

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree, Node
from backend.settings import MAX_NODE_CONTENT_LENGTH_FOR_APPEND
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction, CreateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)


class TestConvertAppendsToChildrenForLongNodes:

    @pytest.fixture
    def mock_tree(self):
        """Create a mock MarkdownTree with embedding disabled"""
        tree = MarkdownTree(output_dir=None, embedding_manager=False)
        return tree

    @pytest.fixture
    def workflow(self, mock_tree):
        """Create a TreeActionDeciderWorkflow instance with mocked agents"""
        workflow = TreeActionDeciderWorkflow(decision_tree=mock_tree)
        return workflow

    def test_append_to_short_node_unchanged(self, workflow, mock_tree):
        """AppendAction targeting node < MAX_NODE_CONTENT_LENGTH_FOR_APPEND chars should remain unchanged"""
        # Setup: create a short node (less than threshold)
        short_content = "This is short content"
        assert len(short_content) < MAX_NODE_CONTENT_LENGTH_FOR_APPEND

        node_id = mock_tree.create_new_node(
            name="Short Node",
            parent_node_id=None,
            content=short_content,
            summary="Short summary"
        )

        append_action = AppendAction(
            action="APPEND",
            target_node_id=node_id,
            target_node_name="Short Node",
            content="New content to append"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: action unchanged
        assert len(result) == 1
        assert isinstance(result[0], AppendAction)
        assert result[0].target_node_id == node_id
        assert result[0].content == "New content to append"

    def test_append_to_long_node_becomes_create(self, workflow, mock_tree):
        """AppendAction targeting node > MAX_NODE_CONTENT_LENGTH_FOR_APPEND chars should become CreateAction"""
        # Setup: create a long node (more than threshold)
        long_content = "x" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)
        assert len(long_content) > MAX_NODE_CONTENT_LENGTH_FOR_APPEND

        node_id = mock_tree.create_new_node(
            name="Long Node",
            parent_node_id=None,
            content=long_content,
            summary="Long node summary"
        )

        append_action = AppendAction(
            action="APPEND",
            target_node_id=node_id,
            target_node_name="Long Node",
            content="New content that should become a child"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: converted to CreateAction
        assert len(result) == 1
        assert isinstance(result[0], CreateAction)

        create_action = result[0]
        assert create_action.parent_node_id == node_id
        assert create_action.relationship == "continuation of"
        assert create_action.content == "New content that should become a child"

    def test_create_actions_unchanged(self, workflow, mock_tree):
        """CreateActions should pass through unchanged regardless of parent node length"""
        # Setup: create a long node
        long_content = "x" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)
        node_id = mock_tree.create_new_node(
            name="Long Parent",
            parent_node_id=None,
            content=long_content,
            summary="Summary"
        )

        create_action = CreateAction(
            action="CREATE",
            parent_node_id=node_id,
            target_node_name="Long Parent",
            new_node_name="New Child",
            content="Child content",
            summary="Child summary",
            relationship="subtask of"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([create_action])

        # Assert: action unchanged
        assert len(result) == 1
        assert isinstance(result[0], CreateAction)
        assert result[0].new_node_name == "New Child"
        assert result[0].relationship == "subtask of"  # Unchanged

    def test_child_name_is_generic_continued(self, workflow, mock_tree):
        """Child node name should use generic '(continued)' suffix, not content-derived"""
        # Setup: create a long node
        long_content = "x" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)
        node_id = mock_tree.create_new_node(
            name="Parent Topic",
            parent_node_id=None,
            content=long_content,
            summary="Summary"
        )

        append_action = AppendAction(
            action="APPEND",
            target_node_id=node_id,
            target_node_name="Parent Topic",
            content="This is a longer piece of content that will be truncated for the name"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: name format is "{parent_title} (continued)"
        assert len(result) == 1
        create_action = result[0]
        assert create_action.new_node_name == "Parent Topic (continued)"

    def test_mixed_actions_list(self, workflow, mock_tree):
        """List with both AppendActions to short and long nodes should only convert long-node appends"""
        # Setup: create both short and long nodes
        short_content = "Short content"
        long_content = "x" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)

        short_node_id = mock_tree.create_new_node(
            name="Short Node",
            parent_node_id=None,
            content=short_content,
            summary="Short summary"
        )

        long_node_id = mock_tree.create_new_node(
            name="Long Node",
            parent_node_id=None,
            content=long_content,
            summary="Long summary"
        )

        actions = [
            AppendAction(
                action="APPEND",
                target_node_id=short_node_id,
                target_node_name="Short Node",
                content="Append to short"
            ),
            AppendAction(
                action="APPEND",
                target_node_id=long_node_id,
                target_node_name="Long Node",
                content="Append to long"
            ),
            CreateAction(
                action="CREATE",
                parent_node_id=short_node_id,
                target_node_name="Short Node",
                new_node_name="New Child",
                content="Child content",
                summary="Child summary",
                relationship="related to"
            )
        ]

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes(actions)

        # Assert: only long-node append converted
        assert len(result) == 3

        # First action should remain AppendAction (short node)
        assert isinstance(result[0], AppendAction)
        assert result[0].target_node_id == short_node_id

        # Second action should be converted to CreateAction (long node)
        assert isinstance(result[1], CreateAction)
        assert result[1].parent_node_id == long_node_id
        assert result[1].relationship == "continuation of"

        # Third action should remain CreateAction unchanged
        assert isinstance(result[2], CreateAction)
        assert result[2].new_node_name == "New Child"
        assert result[2].relationship == "related to"

    def test_append_to_nonexistent_node_unchanged(self, workflow, mock_tree):
        """AppendAction targeting non-existent node should remain unchanged"""
        append_action = AppendAction(
            action="APPEND",
            target_node_id=99999,  # Non-existent
            target_node_name="Ghost Node",
            content="Content"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: action unchanged (graceful handling)
        assert len(result) == 1
        assert isinstance(result[0], AppendAction)
        assert result[0].target_node_id == 99999

    def test_empty_list(self, workflow):
        """Empty action list should return empty list"""
        result = workflow._convert_appends_to_children_for_long_nodes([])
        assert result == []

    def test_content_with_separator_stripped(self, workflow, mock_tree):
        """Content should have +++ separator stripped when converting to child node"""
        # Setup: create a long node
        long_content = "x" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)
        node_id = mock_tree.create_new_node(
            name="Parent",
            parent_node_id=None,
            content=long_content,
            summary="Summary"
        )

        append_action = AppendAction(
            action="APPEND",
            target_node_id=node_id,
            target_node_name="Parent",
            content="\n+++\nActual content starts here"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: separator is stripped from content, name is generic
        assert len(result) == 1
        create_action = result[0]
        assert "+++" not in create_action.content
        assert create_action.content == "Actual content starts here"
        assert create_action.new_node_name == "Parent (continued)"

    def test_node_exactly_at_threshold_unchanged(self, workflow, mock_tree):
        """AppendAction targeting node exactly at threshold should remain unchanged"""
        # Setup: create a node exactly at threshold
        exact_content = "x" * MAX_NODE_CONTENT_LENGTH_FOR_APPEND
        assert len(exact_content) == MAX_NODE_CONTENT_LENGTH_FOR_APPEND

        node_id = mock_tree.create_new_node(
            name="Exact Node",
            parent_node_id=None,
            content=exact_content,
            summary="Summary"
        )

        append_action = AppendAction(
            action="APPEND",
            target_node_id=node_id,
            target_node_name="Exact Node",
            content="New content"
        )

        # Execute
        result = workflow._convert_appends_to_children_for_long_nodes([append_action])

        # Assert: action unchanged (> not >=)
        assert len(result) == 1
        assert isinstance(result[0], AppendAction)
