"""
TDD Integration tests for ChunkProcessor with new tree_actions format
"""

from unittest.mock import AsyncMock
from unittest.mock import Mock

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import (
    ChunkProcessor,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)


class TestChunkProcessorWithNewActions:

    @pytest.fixture
    def decision_tree(self):
        """Create a simple decision tree for testing"""
        tree = MarkdownTree()
        tree.create_new_node(name="Root", parent_node_id=None, content="Root content",
                           summary="Root summary", relationship_to_parent="root")
        return tree

    @pytest.fixture
    def mock_workflow(self):
        """Mock TreeActionDeciderWorkflow"""
        workflow = Mock(spec=TreeActionDeciderWorkflow)
        workflow.process_text_chunk = AsyncMock()
        return workflow

    @pytest.fixture
    def mock_tree_applier(self):
        """Mock TreeActionApplier"""
        applier = Mock(spec=TreeActionApplier)
        applier.apply = Mock(return_value={1, 2})  # Modified node IDs
        return applier

    @pytest.fixture
    def chunk_processor_with_mocks(self, decision_tree, mock_workflow, mock_tree_applier):
        """Create ChunkProcessor with injected mocks"""
        processor = ChunkProcessor(decision_tree)
        processor.workflow = mock_workflow
        processor.tree_action_applier = mock_tree_applier
        return processor

    async def test_processor_uses_tree_actions_not_integration_decisions(
        self, chunk_processor_with_mocks, mock_workflow, mock_tree_applier
    ):
        """ChunkProcessor should process text through workflow which applies tree actions"""
        # Given
        # Mock workflow to return modified nodes
        mock_workflow.process_text_chunk.return_value = {1, 2}

        # Mock buffer manager to indicate text should be processed
        chunk_processor_with_mocks.buffer_manager.getBufferTextWhichShouldBeProcessed = Mock(return_value="test chunk")
        chunk_processor_with_mocks.buffer_manager.get_transcript_history = Mock(return_value="history")

        # When
        await chunk_processor_with_mocks.process_new_text("test chunk")

        # Then
        mock_workflow.process_text_chunk.assert_called_once_with(
            text_chunk="test chunk",
            transcript_history_context="history",
            tree_action_applier=mock_tree_applier,
            buffer_manager=chunk_processor_with_mocks.buffer_manager
        )

    async def test_processor_handles_action_application_results(
        self, chunk_processor_with_mocks, mock_workflow
    ):
        """ChunkProcessor should properly handle modified node IDs from workflow"""
        # Given
        modified_nodes = {1, 2, 3}
        mock_workflow.process_text_chunk.return_value = modified_nodes

        # Mock buffer manager to indicate text should be processed
        chunk_processor_with_mocks.buffer_manager.getBufferTextWhichShouldBeProcessed = Mock(return_value="test")
        chunk_processor_with_mocks.buffer_manager.get_transcript_history = Mock(return_value="history")

        # When
        await chunk_processor_with_mocks.process_new_text("test")

        # Then
        assert chunk_processor_with_mocks.nodes_to_update == modified_nodes

    async def test_processor_handles_empty_tree_actions(
        self, chunk_processor_with_mocks, mock_workflow
    ):
        """ChunkProcessor should handle workflow returning empty set gracefully"""
        # Given
        mock_workflow.process_text_chunk.return_value = set()  # No nodes modified

        # Mock buffer manager to indicate text should be processed
        chunk_processor_with_mocks.buffer_manager.getBufferTextWhichShouldBeProcessed = Mock(return_value="test")
        chunk_processor_with_mocks.buffer_manager.get_transcript_history = Mock(return_value="history")

        # When
        await chunk_processor_with_mocks.process_new_text("test")

        # Then
        assert len(chunk_processor_with_mocks.nodes_to_update) == 0

    async def test_processor_flushes_completed_chunks(
        self, chunk_processor_with_mocks, mock_workflow
    ):
        """ChunkProcessor should pass buffer manager to workflow for flushing"""
        # Given
        # Mock buffer manager
        mock_buffer_manager = Mock()
        mock_buffer_manager.getBufferTextWhichShouldBeProcessed = Mock(return_value="test")
        mock_buffer_manager.get_transcript_history = Mock(return_value="history")
        chunk_processor_with_mocks.buffer_manager = mock_buffer_manager

        # When
        await chunk_processor_with_mocks.process_new_text("test")

        # Then
        # Verify workflow was called with buffer manager
        mock_workflow.process_text_chunk.assert_called_once()
        call_args = mock_workflow.process_text_chunk.call_args
        assert call_args.kwargs['buffer_manager'] == mock_buffer_manager

    async def test_processor_handles_workflow_failure(
        self, chunk_processor_with_mocks, mock_workflow
    ):
        """ChunkProcessor passes exceptions from workflow up to caller"""
        # Given
        mock_workflow.process_text_chunk.side_effect = Exception("Workflow failed")

        # Mock buffer manager to indicate text should be processed
        chunk_processor_with_mocks.buffer_manager.getBufferTextWhichShouldBeProcessed = Mock(return_value="test")
        chunk_processor_with_mocks.buffer_manager.get_transcript_history = Mock(return_value="history")

        # When/Then - should raise exception
        with pytest.raises(Exception, match="Workflow failed"):
            await chunk_processor_with_mocks.process_new_text("test")

        # nodes_to_update should remain unchanged
        assert len(chunk_processor_with_mocks.nodes_to_update) == 0
