"""
TDD Integration tests for WorkflowAdapter with TreeActionDecider
"""

import pytest
from unittest.mock import Mock, AsyncMock, ANY

from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import (
    WorkflowAdapter, WorkflowResult
)
from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    UpdateAction, CreateAction, AppendAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestWorkflowAdapterWithTreeActionDecider:
    
    @pytest.fixture
    def mock_tree_action_decider(self):
        """Mock TreeActionDecider to test WorkflowAdapter in isolation"""
        decider = Mock(spec=TreeActionDecider)
        decider.run = AsyncMock()
        return decider
    
    @pytest.fixture
    def decision_tree(self):
        """Create a simple decision tree for testing"""
        tree = DecisionTree()
        tree.create_new_node(name="Root", parent_node_id=None, content="Root content", 
                           summary="Root summary", relationship_to_parent="root")
        return tree
    
    @pytest.fixture
    def adapter_with_mock_decider(self, mock_tree_action_decider, decision_tree):
        """Create WorkflowAdapter with mocked TreeActionDecider"""
        adapter = WorkflowAdapter(decision_tree)
        adapter.agent = mock_tree_action_decider  # Inject mock
        return adapter
    
    async def test_adapter_calls_decider_correctly(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should pass correct params to TreeActionDecider"""
        # Given
        transcript = "Test transcript"
        context = "Previous context"
        
        # When
        await adapter_with_mock_decider.process_full_buffer(transcript, context)
        
        # Then
        mock_tree_action_decider.run.assert_called_once_with(
            transcript_text=transcript,
            decision_tree=ANY,  # We'll check this is a DecisionTree
            transcript_history=context
        )
        
        # Verify the decision_tree param is correct type
        call_args = mock_tree_action_decider.run.call_args
        assert isinstance(call_args.kwargs['decision_tree'], DecisionTree)
    
    async def test_adapter_transforms_optimization_actions_to_result(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should correctly transform actions to WorkflowResult"""
        # Given
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary"),
            CreateAction(action="CREATE", parent_node_id=1, new_node_name="New Node", 
                        content="Content", summary="Summary", relationship="child of")
        ]
        mock_tree_action_decider.run.return_value = optimization_actions
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.success == True
        assert result.tree_actions == optimization_actions
        assert result.new_nodes == ["New Node"]  # Extracted from CREATE actions
        assert result.metadata["actions_generated"] == 2
        assert result.metadata["completed_chunks"] == ["test"]
        assert result.metadata["processed_text"] == "test"
    
    async def test_adapter_handles_empty_optimization_response(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should handle empty optimization list"""
        # Given
        mock_tree_action_decider.run.return_value = []
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.success == True
        assert result.tree_actions == []
        assert result.new_nodes == []
        assert result.metadata["actions_generated"] == 0
        assert result.metadata["completed_chunks"] == ["test"]
    
    async def test_adapter_handles_decider_exceptions(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should handle exceptions from TreeActionDecider gracefully"""
        # Given
        mock_tree_action_decider.run.side_effect = Exception("Decider failed")
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.success == False
        assert result.tree_actions == []
        assert result.new_nodes == []
        assert "Workflow execution failed: Decider failed" in result.error_message
    
    async def test_adapter_with_no_context(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should handle None context correctly"""
        # Given
        mock_tree_action_decider.run.return_value = []
        
        # When
        await adapter_with_mock_decider.process_full_buffer("test", None)
        
        # Then
        mock_tree_action_decider.run.assert_called_once_with(
            transcript_text="test",
            decision_tree=ANY,
            transcript_history=""  # None should become empty string
        )
    
    async def test_adapter_extracts_multiple_new_nodes(self, adapter_with_mock_decider, mock_tree_action_decider):
        """WorkflowAdapter should extract all new node names from CREATE actions"""
        # Given
        optimization_actions = [
            CreateAction(action="CREATE", parent_node_id=1, new_node_name="Node A", 
                        content="Content A", summary="Summary A", relationship="child of"),
            UpdateAction(action="UPDATE", node_id=2, new_content="Updated", new_summary="Summary"),
            CreateAction(action="CREATE", parent_node_id=1, new_node_name="Node B", 
                        content="Content B", summary="Summary B", relationship="child of")
        ]
        mock_tree_action_decider.run.return_value = optimization_actions
        
        # When
        result = await adapter_with_mock_decider.process_full_buffer("test", "")
        
        # Then
        assert result.new_nodes == ["Node A", "Node B"]
        assert len(result.tree_actions) == 3