"""
Integration tests for TreeActionDeciderWorkflow
"""

from unittest.mock import AsyncMock
from unittest.mock import Mock
from unittest.mock import patch

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAgentResult
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import SegmentModel
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager


class TestTreeActionDeciderWorkflow:

    @pytest.fixture
    def decision_tree(self):
        """Create a simple decision tree for testing"""
        tree = MarkdownTree()
        tree.create_new_node(name="Root", parent_node_id=None, content="Root content",
                           summary="Root summary", relationship_to_parent="root")
        return tree

    @pytest.fixture
    def workflow(self, decision_tree):
        """Create TreeActionDeciderWorkflow with decision tree"""
        return TreeActionDeciderWorkflow(decision_tree)

    @pytest.fixture
    def mock_buffer_manager(self):
        """Create mock TextBufferManager"""
        buffer_manager = Mock(spec=TextBufferManager)
        buffer_manager.flushCompletelyProcessedText = Mock()
        return buffer_manager

    @pytest.fixture
    def mock_tree_applier(self, decision_tree):
        """Create mock TreeActionApplier"""
        applier = Mock(spec=TreeActionApplier)
        applier.apply = Mock()
        return applier

    def create_append_result(self, actions, completed_text="Test content"):
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
    async def test_process_text_chunk_with_actions(self, workflow, mock_buffer_manager, mock_tree_applier):
        """process_text_chunk should apply placement and optimization actions immediately"""
        # Given - mock the agents
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="New content")
        ]
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")
        ]

        workflow.append_agent.run = AsyncMock(return_value=self.create_append_result(placement_actions, "New content"))
        workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)

        # Mock tree applier to return modified nodes
        mock_tree_applier.apply.side_effect = [
            {1},  # First call (placement)
            {1}   # Second call (optimization)
        ]

        # When
        modified_nodes = await workflow.process_text_chunk(
            text_chunk="test transcript",
            tree_action_applier=mock_tree_applier,
            buffer_manager=mock_buffer_manager
        )

        # Then
        # 1. Both agents were called
        workflow.append_agent.run.assert_called_once()
        workflow.optimizer_agent.run.assert_called_once()

        # 2. Actions were applied immediately
        assert mock_tree_applier.apply.call_count == 2

        # 3. Buffer was flushed with completed text
        mock_buffer_manager.flushCompletelyProcessedText.assert_called_once_with("New content")

        # 4. Modified nodes are returned
        assert modified_nodes == {1}

    @pytest.mark.asyncio
    async def test_process_text_chunk_no_placement_actions(self, workflow, mock_buffer_manager, mock_tree_applier):
        """Should handle case when no placement actions are generated"""
        # Given
        workflow.append_agent.run = AsyncMock(return_value=self.create_append_result([], ""))
        workflow.optimizer_agent.run = AsyncMock()  # Mock the optimizer agent
        mock_tree_applier.apply.return_value = set()  # Return empty set when no actions

        # When
        modified_nodes = await workflow.process_text_chunk(
            text_chunk="test",
            tree_action_applier=mock_tree_applier,
            buffer_manager=mock_buffer_manager
        )

        # Then
        # 1. No optimization (because no nodes were modified)
        workflow.optimizer_agent.run.assert_not_called()
        # Tree applier is still called with empty actions list
        mock_tree_applier.apply.assert_called_once_with([])

        # 2. No buffer flush when no completed text
        mock_buffer_manager.flushCompletelyProcessedText.assert_not_called()

        # 3. Empty set returned
        assert modified_nodes == set()

    @pytest.mark.asyncio
    async def test_process_text_chunk_orphan_merging(self, workflow, mock_buffer_manager, mock_tree_applier):
        """Multiple orphan nodes should be merged into one"""
        # Given - multiple orphan CREATE actions with the same name
        placement_actions = [
            CreateAction(action="CREATE", parent_node_id=None, new_node_name="Same Topic",
                        content="Content 1", summary="Summary 1", relationship=""),
            CreateAction(action="CREATE", parent_node_id=None, new_node_name="Same Topic",
                        content="Content 2", summary="Summary 2", relationship=""),
            AppendAction(action="APPEND", target_node_id=1, content="Regular content")
        ]

        workflow.append_agent.run = AsyncMock(return_value=self.create_append_result(placement_actions))
        workflow.optimizer_agent.run = AsyncMock(return_value=[])
        mock_tree_applier.apply.return_value = {1}

        # When
        await workflow.process_text_chunk(
            text_chunk="test",
            tree_action_applier=mock_tree_applier,
            buffer_manager=mock_buffer_manager
        )

        # Then - verify orphans were merged
        applied_actions = mock_tree_applier.apply.call_args[0][0]
        assert len(applied_actions) == 2  # 1 merged orphan + 1 append

        orphan_actions = [a for a in applied_actions if isinstance(a, CreateAction) and a.parent_node_id is None]
        assert len(orphan_actions) == 1

        merged_orphan = orphan_actions[0]
        assert merged_orphan.new_node_name == "Same Topic"
        assert "Content 1" in merged_orphan.content
        assert "Content 2" in merged_orphan.content

    @pytest.mark.asyncio
    async def test_run_method_returns_optimization_actions(self, workflow):
        """The run() method should return optimization actions"""
        # Given
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="New content")
        ]
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")
        ]

        workflow.append_agent.run = AsyncMock(return_value=self.create_append_result(placement_actions))
        workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)

        # Patch dependencies
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
            mock_applier = Mock()
            mock_applier.apply.return_value = {1}
            mock_applier_class.return_value = mock_applier

            # When
            actions = await workflow.run("test", workflow.decision_tree, "context")

        # Then
        assert actions == optimization_actions
        assert len(actions) == 1
        assert isinstance(actions[0], UpdateAction)
