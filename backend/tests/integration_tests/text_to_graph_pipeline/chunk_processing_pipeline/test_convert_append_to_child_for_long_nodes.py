"""
TDD Integration tests for converting appends to child nodes when target is too long.

These tests verify the end-to-end behavior of the workflow when it encounters
AppendActions targeting nodes that exceed MAX_NODE_CONTENT_LENGTH_FOR_APPEND.
The function _convert_appends_to_children_for_long_nodes does not exist yet.
"""

from unittest.mock import AsyncMock
from unittest.mock import Mock
from unittest.mock import patch

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.settings import MAX_NODE_CONTENT_LENGTH_FOR_APPEND
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAgentResult
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import SegmentModel
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager


class TestConvertAppendToChildForLongNodesIntegration:
    """
    Integration tests that verify the workflow correctly converts AppendActions
    to CreateActions when the target node exceeds MAX_NODE_CONTENT_LENGTH_FOR_APPEND.
    """

    @pytest.fixture
    def long_content(self) -> str:
        """Content that exceeds MAX_NODE_CONTENT_LENGTH_FOR_APPEND"""
        return "A" * (MAX_NODE_CONTENT_LENGTH_FOR_APPEND + 100)

    @pytest.fixture
    def short_content(self) -> str:
        """Content that is under MAX_NODE_CONTENT_LENGTH_FOR_APPEND"""
        return "Short content"

    @pytest.fixture
    def decision_tree_with_long_node(self, long_content: str) -> MarkdownTree:
        """Create a decision tree with a node that exceeds the length threshold"""
        tree = MarkdownTree()
        tree.create_new_node(
            name="Long Node",
            parent_node_id=None,
            content=long_content,
            summary="A very long node",
            relationship_to_parent="root"
        )
        return tree

    @pytest.fixture
    def decision_tree_with_short_node(self, short_content: str) -> MarkdownTree:
        """Create a decision tree with a node under the length threshold"""
        tree = MarkdownTree()
        tree.create_new_node(
            name="Short Node",
            parent_node_id=None,
            content=short_content,
            summary="A short node",
            relationship_to_parent="root"
        )
        return tree

    @pytest.fixture
    def mock_buffer_manager(self) -> Mock:
        """Create mock TextBufferManager"""
        buffer_manager = Mock(spec=TextBufferManager)
        buffer_manager.flushCompletelyProcessedText = Mock()
        buffer_manager.getBuffer = Mock(return_value="")
        buffer_manager.bufferFlushLength = 500
        return buffer_manager

    @pytest.fixture
    def mock_tree_applier_tracking_actions(self) -> Mock:
        """Create TreeActionApplier mock that tracks applied actions"""
        applier = Mock(spec=TreeActionApplier)
        applier.applied_actions = []

        def track_apply(actions):
            applier.applied_actions.extend(actions)
            return {1}  # Return modified node IDs

        applier.apply = Mock(side_effect=track_apply)
        return applier

    def create_append_result(self, actions: list, completed_text: str = "Test content") -> AppendAgentResult:
        """Helper to create AppendAgentResult"""
        segments = []
        for action in actions:
            if hasattr(action, 'content'):
                segments.append(SegmentModel(
                    reasoning="Test reasoning",
                    edited_text=action.content,
                    raw_text=action.content,
                    is_routable=True
                ))

        return AppendAgentResult(
            actions=actions,
            segments=segments,
            completed_text=completed_text
        )

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_append_to_long_node_becomes_child_creation(
        self,
        mock_sync: Mock,
        decision_tree_with_long_node: MarkdownTree,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        When the append agent returns an AppendAction targeting a node > MAX_NODE_CONTENT_LENGTH_FOR_APPEND,
        the workflow should convert it to a CreateAction with the target as parent.
        """
        # Given: workflow with a long node
        workflow = TreeActionDeciderWorkflow(decision_tree_with_long_node)
        long_node_id = 1  # First created node

        # Mock append agent to return an append action targeting the long node
        append_content = "New content to append"
        append_action = AppendAction(
            action="APPEND",
            target_node_id=long_node_id,
            target_node_name="Long Node",
            content=append_content
        )
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result([append_action], append_content)
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When: process a text chunk
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: the applied actions should contain a CreateAction, not AppendAction
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 1

        action = applied_actions[0]
        assert isinstance(action, CreateAction), \
            f"Expected CreateAction but got {type(action).__name__}"
        assert action.parent_node_id == long_node_id, \
            "CreateAction should have the long node as parent"
        assert action.content == append_content, \
            "CreateAction should preserve the original content"
        assert action.relationship == "continuation of", \
            "Relationship should indicate continuation"

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_append_to_short_node_remains_append(
        self,
        mock_sync: Mock,
        decision_tree_with_short_node: MarkdownTree,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        When the append agent returns an AppendAction targeting a node <= MAX_NODE_CONTENT_LENGTH_FOR_APPEND,
        the workflow should keep it as an AppendAction (no conversion).
        """
        # Given: workflow with a short node
        workflow = TreeActionDeciderWorkflow(decision_tree_with_short_node)
        short_node_id = 1

        # Mock append agent to return an append action targeting the short node
        append_content = "New content to append"
        append_action = AppendAction(
            action="APPEND",
            target_node_id=short_node_id,
            target_node_name="Short Node",
            content=append_content
        )
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result([append_action], append_content)
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When: process a text chunk
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: the applied action should remain an AppendAction
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 1

        action = applied_actions[0]
        assert isinstance(action, AppendAction), \
            f"Expected AppendAction but got {type(action).__name__}"
        assert action.target_node_id == short_node_id
        assert action.content == append_content

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_mixed_actions_only_long_node_appends_converted(
        self,
        mock_sync: Mock,
        long_content: str,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        When the append agent returns multiple actions (some to long nodes, some to short),
        only the appends targeting long nodes should be converted.
        """
        # Given: tree with both long and short nodes
        tree = MarkdownTree()
        tree.create_new_node(
            name="Long Node",
            parent_node_id=None,
            content=long_content,
            summary="Long node",
            relationship_to_parent="root"
        )
        tree.create_new_node(
            name="Short Node",
            parent_node_id=None,
            content="Short content",
            summary="Short node",
            relationship_to_parent="root"
        )
        long_node_id = 1
        short_node_id = 2

        workflow = TreeActionDeciderWorkflow(tree)

        # Mock append agent to return actions for both nodes
        actions = [
            AppendAction(
                action="APPEND",
                target_node_id=long_node_id,
                target_node_name="Long Node",
                content="Content for long node"
            ),
            AppendAction(
                action="APPEND",
                target_node_id=short_node_id,
                target_node_name="Short Node",
                content="Content for short node"
            ),
        ]
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result(actions, "All content")
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: should have one CreateAction (for long node) and one AppendAction (for short node)
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 2

        create_actions = [a for a in applied_actions if isinstance(a, CreateAction)]
        append_actions = [a for a in applied_actions if isinstance(a, AppendAction)]

        assert len(create_actions) == 1, "Long node append should be converted to CreateAction"
        assert len(append_actions) == 1, "Short node append should remain AppendAction"

        assert create_actions[0].parent_node_id == long_node_id
        assert append_actions[0].target_node_id == short_node_id

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_create_actions_pass_through_unchanged(
        self,
        mock_sync: Mock,
        decision_tree_with_long_node: MarkdownTree,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        CreateActions from the append agent should pass through unchanged,
        regardless of any node lengths.
        """
        # Given
        workflow = TreeActionDeciderWorkflow(decision_tree_with_long_node)

        # Create action (new node creation) - should not be affected by conversion logic
        create_action = CreateAction(
            action="CREATE",
            parent_node_id=None,
            target_node_name=None,
            new_node_name="New Topic",
            content="New topic content",
            summary="",
            relationship=""
        )
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result([create_action], "New topic content")
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: CreateAction should pass through unchanged
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 1

        action = applied_actions[0]
        assert isinstance(action, CreateAction)
        assert action.new_node_name == "New Topic"
        assert action.parent_node_id is None  # Still orphan, not changed

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_converted_child_name_derived_from_content(
        self,
        mock_sync: Mock,
        decision_tree_with_long_node: MarkdownTree,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        When an append is converted to a child creation, the new node name
        should be derived from the parent title and a preview of the content.
        """
        # Given
        workflow = TreeActionDeciderWorkflow(decision_tree_with_long_node)
        long_node_id = 1

        append_content = "This is a detailed explanation of the concept that continues the discussion"
        append_action = AppendAction(
            action="APPEND",
            target_node_id=long_node_id,
            target_node_name="Long Node",
            content=append_content
        )
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result([append_action], append_content)
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: the child name should contain parent title and content preview
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 1

        action = applied_actions[0]
        assert isinstance(action, CreateAction)

        # Name should be "{parent_title} - {first_30_chars}..."
        assert "Long Node" in action.new_node_name, \
            "Child name should include parent title"
        assert action.new_node_name.endswith("..."), \
            "Child name should end with ellipsis for truncated content"

    @pytest.mark.asyncio
    @patch("backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.sync_nodes_from_markdown")
    async def test_node_at_exact_threshold_not_converted(
        self,
        mock_sync: Mock,
        mock_buffer_manager: Mock,
        mock_tree_applier_tracking_actions: Mock
    ):
        """
        A node at exactly MAX_NODE_CONTENT_LENGTH_FOR_APPEND should NOT be converted.
        The conversion only happens for nodes strictly greater than the threshold.
        """
        # Given: node exactly at threshold
        tree = MarkdownTree()
        tree.create_new_node(
            name="Threshold Node",
            parent_node_id=None,
            content="A" * MAX_NODE_CONTENT_LENGTH_FOR_APPEND,  # Exactly at threshold
            summary="Exactly at threshold",
            relationship_to_parent="root"
        )
        threshold_node_id = 1

        workflow = TreeActionDeciderWorkflow(tree)

        append_action = AppendAction(
            action="APPEND",
            target_node_id=threshold_node_id,
            target_node_name="Threshold Node",
            content="New content"
        )
        workflow.append_agent.run = AsyncMock(
            return_value=self.create_append_result([append_action], "New content")
        )
        workflow.optimizer_agent.run = AsyncMock(return_value=[])

        # When
        await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier_tracking_actions,
            buffer_manager=mock_buffer_manager
        )

        # Then: should remain an AppendAction (threshold is > not >=)
        applied_actions = mock_tree_applier_tracking_actions.applied_actions
        assert len(applied_actions) == 1

        action = applied_actions[0]
        assert isinstance(action, AppendAction), \
            "Node exactly at threshold should NOT be converted"
