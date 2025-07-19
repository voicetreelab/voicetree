"""
TDD Integration tests for TreeActionDeciderWorkflow
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch

from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow, WorkflowResult
)
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    UpdateAction, CreateAction, AppendAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestTreeActionDeciderWorkflow:
    
    @pytest.fixture
    def decision_tree(self):
        """Create a simple decision tree for testing"""
        tree = DecisionTree()
        tree.create_new_node(name="Root", parent_node_id=None, content="Root content", 
                           summary="Root summary", relationship_to_parent="root")
        return tree
    
    @pytest.fixture
    def workflow(self, decision_tree):
        """Create TreeActionDeciderWorkflow with decision tree"""
        return TreeActionDeciderWorkflow(decision_tree)
    
    async def test_process_full_buffer_with_optimization_actions(self, workflow):
        """TreeActionDeciderWorkflow should correctly process buffer and return WorkflowResult"""
        # Given - mock the agents
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="New content")
        ]
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary"),
            CreateAction(action="CREATE", parent_node_id=1, new_node_name="New Node", 
                        content="Content", summary="Summary", relationship="child of")
        ]
        
        workflow.append_agent.run = AsyncMock(return_value=placement_actions)
        workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
        
        # Patch TreeActionApplier
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
            mock_applier = Mock()
            mock_applier.apply.return_value = {1}  # node 1 was modified
            mock_applier_class.return_value = mock_applier
            
            # When
            result = await workflow.process_full_buffer("test transcript", "context")
        
        # Then
        assert result.success == True
        assert result.tree_actions == optimization_actions
        assert result.new_nodes == ["New Node"]  # Extracted from CREATE actions
        assert result.metadata["actions_generated"] == 2
        assert result.metadata["completed_chunks"] == ["test transcript"]
        assert result.metadata["processed_text"] == "test transcript"
    
    async def test_process_full_buffer_with_no_actions(self, workflow):
        """Should handle case when no placement actions are generated"""
        # Given
        workflow.append_agent.run = AsyncMock(return_value=[])
        
        # When
        result = await workflow.process_full_buffer("test", "")
        
        # Then
        assert result.success == True
        assert result.tree_actions == []
        assert result.new_nodes == []
        assert result.metadata["actions_generated"] == 0
    
    async def test_process_full_buffer_error_handling(self, workflow):
        """Should handle errors gracefully"""
        # Given
        workflow.append_agent.run = AsyncMock(side_effect=Exception("Test error"))
        
        # When
        result = await workflow.process_full_buffer("test", "")
        
        # Then
        assert result.success == False
        assert result.error_message == "Workflow execution failed: Test error"
        assert result.tree_actions == []
        assert result.new_nodes == []
    
    async def test_run_method_returns_raw_actions(self, workflow):
        """The run() method should return raw optimization actions without wrapping"""
        # Given
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="New content")
        ]
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Updated", new_summary="Summary")
        ]
        
        workflow.append_agent.run = AsyncMock(return_value=placement_actions)
        workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
        
        # Patch TreeActionApplier
        with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
            mock_applier = Mock()
            mock_applier.apply.return_value = {1}
            mock_applier_class.return_value = mock_applier
            
            # When
            actions = await workflow.run("test", workflow.decision_tree, "context")
        
        # Then
        assert actions == optimization_actions
        assert isinstance(actions, list)
        assert all(isinstance(a, (UpdateAction, CreateAction)) for a in actions)