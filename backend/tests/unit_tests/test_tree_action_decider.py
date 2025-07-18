"""
Unit tests for TreeActionDecider orchestrator using TDD approach.

These tests use mocks to verify orchestration logic without running actual LLMs.
Tests focus on:
1. Correct agent orchestration order
2. Placement actions staying internal
3. Optimization action aggregation
4. Edge case handling
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from typing import List

# Import models first (these should exist)
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, 
    CreateAction, 
    UpdateAction,
    BaseTreeAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node

# This import will fail until TreeActionDecider is implemented
# We'll use a temporary stub for TDD
try:
    from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider
except ImportError:
    # TDD stub - will be replaced when actual implementation exists
    class TreeActionDecider:
        def __init__(self):
            self.append_agent = None
            self.optimizer_agent = None
            
        async def run(self, transcript_text: str, decision_tree, transcript_history: str = "") -> List:
            raise NotImplementedError("TreeActionDecider not implemented yet")


class TestTreeActionDeciderUnit:
    """Unit tests for TreeActionDecider orchestration logic"""
    
    @pytest.fixture
    def mock_append_agent(self):
        """Mock AppendToRelevantNodeAgent"""
        agent = Mock()
        agent.run = AsyncMock()
        return agent
    
    @pytest.fixture
    def mock_optimizer_agent(self):
        """Mock SingleAbstractionOptimizerAgent"""
        agent = Mock()
        agent.run = AsyncMock()
        return agent
    
    @pytest.fixture
    def mock_tree_applier(self):
        """Mock TreeActionApplier"""
        applier = Mock()
        applier.apply = Mock()
        return applier
    
    @pytest.fixture
    def simple_tree(self):
        """Create a simple tree for testing"""
        tree = DecisionTree()
        node = Node(
            name="Test Node",
            node_id=1,
            content="Test content",
            summary="Test summary"
        )
        tree.tree[1] = node
        return tree
    
    @pytest.fixture
    def orchestrator(self, mock_append_agent, mock_optimizer_agent):
        """Create TreeActionDecider with mocked dependencies"""
        decider = TreeActionDecider()
        decider.append_agent = mock_append_agent
        decider.optimizer_agent = mock_optimizer_agent
        return decider
    
    @pytest.mark.asyncio
    async def test_orchestrator_calls_agents_in_correct_order(
        self, orchestrator, mock_append_agent, mock_optimizer_agent, 
        mock_tree_applier, simple_tree
    ):
        """Test Case 1: Verify two-step pipeline execution order"""
        # Given: Mock agents that return predictable actions
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="New content"),
            CreateAction(
                action="CREATE",
                parent_node_id=1, 
                new_node_name="New Node", 
                content="Content",
                summary="New node summary",
                relationship="subtask of"
            )
        ]
        mock_append_agent.run.return_value = placement_actions
        
        # Mock TreeActionApplier to return modified nodes
        mock_tree_applier.apply.return_value = {1, 99}  # nodes 1 and 99 were modified
        
        # Mock optimizer to return optimization actions
        optimization_actions = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Optimized content", new_summary="New summary")
        ]
        mock_optimizer_agent.run.return_value = optimization_actions
        
        # Patch TreeActionApplier
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            result = await orchestrator.run(
                transcript_text="Test transcript",
                decision_tree=simple_tree,
                transcript_history=""
            )
        
        # Then: Verify call order
        # 1. AppendAgent called first
        mock_append_agent.run.assert_called_once_with(
            transcript_text="Test transcript",
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # 2. TreeActionApplier called with placement actions
        mock_tree_applier.apply.assert_called_once_with(placement_actions)
        
        # 3. OptimizerAgent called for each modified node
        assert mock_optimizer_agent.run.call_count == 2  # Called for nodes 1 and 99
        
        # 4. Only optimization actions returned
        assert result == optimization_actions * 2  # Since we mocked same response for both nodes
    
    @pytest.mark.asyncio
    async def test_placement_actions_stay_internal(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        mock_tree_applier, simple_tree
    ):
        """Test Case 2: Placement actions should not be in final output"""
        # Given: AppendAgent returns placement actions
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="Append this"),
            CreateAction(
                action="CREATE",
                parent_node_id=1, 
                new_node_name="New Node", 
                content="Create this",
                summary="New node summary",
                relationship="related to"
            )
        ]
        mock_append_agent.run.return_value = placement_actions
        
        # Mock applier and optimizer
        mock_tree_applier.apply.return_value = {1}
        mock_optimizer_agent.run.return_value = [
            UpdateAction(action="UPDATE", node_id=1, new_content="Optimized", new_summary="Summary")
        ]
        
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            result = await orchestrator.run(
                transcript_text="Test",
                decision_tree=simple_tree
            )
        
        # Then: Output contains NO placement actions
        assert not any(isinstance(action, AppendAction) for action in result)
        assert all(isinstance(action, (UpdateAction, CreateAction)) for action in result)
        # Note: CreateAction can appear in optimization results, but not AppendAction
    
    @pytest.mark.asyncio
    async def test_tracks_modified_nodes_from_placement(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        mock_tree_applier, simple_tree
    ):
        """Test Case 3: Orchestrator tracks which nodes were modified"""
        # Given: Placement actions that modify specific nodes
        placement_actions = [
            AppendAction(action="APPEND", target_node_id=1, content="Content 1"),
            AppendAction(action="APPEND", target_node_id=3, content="Content 3"),
            CreateAction(
                action="CREATE",
                parent_node_id=2, 
                new_node_name="New", 
                content="Content",
                summary="New node summary",
                relationship="child of"
            )
        ]
        mock_append_agent.run.return_value = placement_actions
        
        # TreeActionApplier reports nodes 1, 3, and 5 were modified
        modified_nodes = {1, 3, 5}
        mock_tree_applier.apply.return_value = modified_nodes
        
        # Mock optimizer responses
        mock_optimizer_agent.run.return_value = []
        
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            await orchestrator.run(
                transcript_text="Test",
                decision_tree=simple_tree
            )
        
        # Then: OptimizerAgent called exactly for nodes [1, 3, 5]
        assert mock_optimizer_agent.run.call_count == len(modified_nodes)
        
        # Verify each node was passed to optimizer
        called_node_ids = {
            call.kwargs['node_id'] 
            for call in mock_optimizer_agent.run.call_args_list
        }
        assert called_node_ids == modified_nodes
    
    @pytest.mark.asyncio
    async def test_aggregates_optimization_actions(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        mock_tree_applier, simple_tree
    ):
        """Test Case 4: All optimization actions are collected and returned"""
        # Given: 3 modified nodes
        mock_append_agent.run.return_value = [
            AppendAction(action="APPEND", target_node_id=1, content="Test")
        ]
        mock_tree_applier.apply.return_value = {1, 2, 3}
        
        # Each node produces different optimization actions
        def optimizer_side_effect(node_id, **kwargs):
            if node_id == 1:
                return [
                    UpdateAction(action="UPDATE", node_id=1, new_content="Updated 1", new_summary="Summary 1"),
                    CreateAction(
                        action="CREATE",
                        parent_node_id=1, 
                        new_node_name="Child 1", 
                        content="Content",
                        summary="Child summary",
                        relationship="subtask of"
                    )
                ]
            elif node_id == 2:
                return [
                    UpdateAction(action="UPDATE", node_id=2, new_content="Updated 2", new_summary="Summary 2")
                ]
            else:  # node_id == 3
                return [
                    CreateAction(
                        action="CREATE",
                        parent_node_id=3, 
                        new_node_name="Child 3", 
                        content="Content",
                        summary="Child summary",
                        relationship="subtask of"
                    )
                ]
        
        mock_optimizer_agent.run.side_effect = optimizer_side_effect
        
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            result = await orchestrator.run(
                transcript_text="Test",
                decision_tree=simple_tree
            )
        
        # Then: Output contains all 4 optimization actions (2+1+1)
        assert len(result) == 4
        assert sum(1 for a in result if isinstance(a, UpdateAction)) == 2
        assert sum(1 for a in result if isinstance(a, CreateAction)) == 2
    
    @pytest.mark.asyncio
    async def test_handles_empty_optimization_response(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        mock_tree_applier, simple_tree
    ):
        """Test Case 5: Gracefully handles when optimizer returns no actions"""
        # Given: Some nodes return empty optimization
        mock_append_agent.run.return_value = [
            AppendAction(action="APPEND", target_node_id=1, content="Test")
        ]
        mock_tree_applier.apply.return_value = {1, 2, 3}
        
        # Mixed responses - some empty, some with actions
        def optimizer_side_effect(node_id, **kwargs):
            if node_id == 1:
                return []  # Empty
            elif node_id == 2:
                return [UpdateAction(action="UPDATE", node_id=2, new_content="Updated", new_summary="Summary")]
            else:
                return []  # Empty
        
        mock_optimizer_agent.run.side_effect = optimizer_side_effect
        
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            result = await orchestrator.run(
                transcript_text="Test",
                decision_tree=simple_tree
            )
        
        # Then: Output contains only non-empty responses
        assert len(result) == 1
        assert isinstance(result[0], UpdateAction)
        assert result[0].node_id == 2
    
    @pytest.mark.asyncio
    async def test_no_placement_actions(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        simple_tree
    ):
        """Test Case 6: Handle when no placement needed"""
        # Given: AppendAgent returns empty list
        mock_append_agent.run.return_value = []
        
        # When: Run orchestrator
        result = await orchestrator.run(
            transcript_text="Test",
            decision_tree=simple_tree
        )
        
        # Then: No optimizer calls, empty output
        mock_optimizer_agent.run.assert_not_called()
        assert result == []
    
    @pytest.mark.asyncio
    async def test_placement_creates_new_nodes(
        self, orchestrator, mock_append_agent, mock_optimizer_agent,
        mock_tree_applier, simple_tree
    ):
        """Test Case 7: New nodes from CreateAction are optimized"""
        # Given: CreateAction creates a new node
        placement_actions = [
            CreateAction(
                action="CREATE",
                parent_node_id=1, 
                new_node_name="New Node", 
                content="Content",
                summary="New node summary",
                relationship="child of"
            )
        ]
        mock_append_agent.run.return_value = placement_actions
        
        # TreeActionApplier reports new node 99 was created
        mock_tree_applier.apply.return_value = {99}
        
        # Mock optimizer response for new node
        mock_optimizer_agent.run.return_value = [
            UpdateAction(action="UPDATE", node_id=99, new_content="Optimized new node", new_summary="Summary")
        ]
        
        with patch('backend.text_to_graph_pipeline.orchestration.tree_action_decider.TreeActionApplier') as mock_applier_class:
            mock_applier_class.return_value = mock_tree_applier
            
            # When: Run orchestrator
            result = await orchestrator.run(
                transcript_text="Test",
                decision_tree=simple_tree
            )
        
        # Then: OptimizerAgent called for new node 99
        mock_optimizer_agent.run.assert_called_once_with(
            node_id=99,
            decision_tree=simple_tree
        )
        
        # And optimization action is returned
        assert len(result) == 1
        assert result[0].node_id == 99