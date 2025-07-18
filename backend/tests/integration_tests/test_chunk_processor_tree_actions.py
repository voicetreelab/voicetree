"""
TDD Integration tests for ChunkProcessor with new tree_actions format
"""

import pytest
from unittest.mock import Mock, AsyncMock, ANY

from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestChunkProcessorWithNewActions:
    
    @pytest.fixture
    def decision_tree(self):
        """Create a simple decision tree for testing"""
        tree = DecisionTree()
        tree.create_new_node(name="Root", parent_node_id=None, content="Root content", 
                           summary="Root summary", relationship_to_parent="root")
        return tree
    
    @pytest.fixture
    def mock_workflow_adapter(self):
        """Mock WorkflowAdapter that returns new action format"""
        adapter = Mock()
        adapter.process_full_buffer = AsyncMock()
        return adapter
    
    @pytest.fixture
    def mock_tree_applier(self):
        """Mock TreeActionApplier"""
        applier = Mock(spec=TreeActionApplier)
        applier.apply = Mock(return_value={1, 2})  # Modified node IDs
        return applier
    
    @pytest.fixture
    def chunk_processor_with_mocks(self, decision_tree, mock_workflow_adapter, mock_tree_applier):
        """Create ChunkProcessor with injected mocks"""
        processor = ChunkProcessor(decision_tree)
        processor.workflow_adapter = mock_workflow_adapter
        processor.tree_action_applier = mock_tree_applier
        return processor
    
    async def test_processor_uses_tree_actions_not_integration_decisions(
        self, chunk_processor_with_mocks, mock_workflow_adapter, mock_tree_applier
    ):
        """ChunkProcessor should use result.tree_actions instead of integration_decisions"""
        # Given
        tree_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")
        ]
        workflow_result = WorkflowResult(
            success=True,
            tree_actions=tree_actions,
            new_nodes=[],
            metadata={"completed_chunks": ["test"]}
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test chunk", "context")
        
        # Then
        mock_tree_applier.apply.assert_called_once_with(tree_actions)
    
    async def test_processor_handles_action_application_results(
        self, chunk_processor_with_mocks, mock_workflow_adapter, mock_tree_applier
    ):
        """ChunkProcessor should properly handle modified node IDs from applier"""
        # Given
        modified_nodes = {1, 2, 3}
        mock_tree_applier.apply.return_value = modified_nodes
        
        workflow_result = WorkflowResult(
            success=True,
            tree_actions=[UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")],
            new_nodes=[],
            metadata={"completed_chunks": ["test"]}
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test", "context")
        
        # Then
        assert chunk_processor_with_mocks.nodes_to_update == modified_nodes
    
    async def test_processor_handles_empty_tree_actions(
        self, chunk_processor_with_mocks, mock_workflow_adapter, mock_tree_applier
    ):
        """ChunkProcessor should handle empty tree_actions list gracefully"""
        # Given
        workflow_result = WorkflowResult(
            success=True,
            tree_actions=[],
            new_nodes=[],
            metadata={"completed_chunks": ["test"]}
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        mock_tree_applier.apply.return_value = set()  # No nodes modified
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test", "context")
        
        # Then
        mock_tree_applier.apply.assert_called_once_with([])
        assert len(chunk_processor_with_mocks.nodes_to_update) == 0
    
    async def test_processor_flushes_completed_chunks(
        self, chunk_processor_with_mocks, mock_workflow_adapter
    ):
        """ChunkProcessor should flush completed chunks from buffer"""
        # Given
        completed_chunks = ["chunk1", "chunk2"]
        workflow_result = WorkflowResult(
            success=True,
            tree_actions=[],
            new_nodes=[],
            metadata={"completed_chunks": completed_chunks}
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        
        # Mock the buffer manager
        mock_buffer_manager = Mock()
        mock_buffer_manager.flushCompletelyProcessedText = Mock()
        chunk_processor_with_mocks.buffer_manager = mock_buffer_manager
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test", "context")
        
        # Then
        assert mock_buffer_manager.flushCompletelyProcessedText.call_count == 2
        mock_buffer_manager.flushCompletelyProcessedText.assert_any_call("chunk1")
        mock_buffer_manager.flushCompletelyProcessedText.assert_any_call("chunk2")
    
    async def test_processor_handles_workflow_failure(
        self, chunk_processor_with_mocks, mock_workflow_adapter, mock_tree_applier
    ):
        """ChunkProcessor should handle workflow failures gracefully"""
        # Given
        workflow_result = WorkflowResult(
            success=False,
            tree_actions=[],
            new_nodes=[],
            error_message="Workflow failed"
        )
        mock_workflow_adapter.process_full_buffer.return_value = workflow_result
        
        # When
        await chunk_processor_with_mocks._process_text_chunk("test", "context")
        
        # Then
        # Should not call tree_applier when workflow fails
        mock_tree_applier.apply.assert_not_called()
        # nodes_to_update should remain unchanged
        assert len(chunk_processor_with_mocks.nodes_to_update) == 0