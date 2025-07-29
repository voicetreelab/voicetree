"""
Behavioral test for the clustering workflow driver.

Tests that the workflow driver correctly orchestrates:
1. Formatting nodes using _format_nodes_for_prompt()
2. Calling ClusteringAgent with formatted nodes and node count
3. Updating tree in place with cluster_name attributes from agent response
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from typing import Dict

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.agentic_workflows.models import ClusteringResponse, ClusterAssignment
from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis


@pytest.fixture
def sample_tree() -> Dict[int, Node]:
    """Create a sample tree with 3 nodes for testing"""
    return {
        1: Node("Dogs", 1, "Info about dogs", "Summary about dogs"),
        2: Node("Cats", 2, "Info about cats", "Summary about cats"), 
        3: Node("Birds", 3, "Info about birds", "Summary about birds")
    }


@pytest.fixture
def mock_clustering_response() -> ClusteringResponse:
    """Mock clustering response from agent"""
    return ClusteringResponse(
        clusters=[
            ClusterAssignment(node_id=1, cluster_name="Domestic Pets", reasoning="Dogs are pets"),
            ClusterAssignment(node_id=2, cluster_name="Domestic Pets", reasoning="Cats are pets"),
            ClusterAssignment(node_id=3, cluster_name=None, reasoning="Birds not clustered")
        ]
    )


@pytest.mark.asyncio
async def test_run_clustering_analysis_orchestration(sample_tree, mock_clustering_response):
    """Test that workflow driver correctly orchestrates all components"""
    
    # Mock the dependencies
    with patch('backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver._format_nodes_for_prompt') as mock_format, \
         patch('backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver.ClusteringAgent') as mock_agent_class:
        
        # Setup mocks
        mock_format.return_value = "formatted nodes string"
        mock_agent_instance = Mock()
        mock_agent_instance.run = AsyncMock(return_value=mock_clustering_response)
        mock_agent_class.return_value = mock_agent_instance
        
        # Run the workflow driver
        await run_clustering_analysis(sample_tree)
        
        # Verify _format_nodes_for_prompt was called with correct nodes and tree
        mock_format.assert_called_once()
        formatted_nodes_call_args = mock_format.call_args[0][0]  # First positional argument (nodes)
        tree_call_args = mock_format.call_args[0][1]  # Second positional argument (tree)
        assert len(formatted_nodes_call_args) == 3  # Should have all 3 nodes
        node_ids = {node.id for node in formatted_nodes_call_args}
        assert node_ids == {1, 2, 3}
        assert tree_call_args == sample_tree  # Should pass the tree as well
        
        # Verify ClusteringAgent was instantiated
        mock_agent_class.assert_called_once()
        
        # Verify agent.run was called with formatted nodes and node count
        mock_agent_instance.run.assert_called_once_with("formatted nodes string", 3)
        
        # Verify tree was updated in place with cluster_name attributes
        assert hasattr(sample_tree[1], 'cluster_name')
        assert hasattr(sample_tree[2], 'cluster_name')
        assert hasattr(sample_tree[3], 'cluster_name')
        
        assert sample_tree[1].cluster_name == "Domestic Pets"
        assert sample_tree[2].cluster_name == "Domestic Pets"
        assert sample_tree[3].cluster_name is None


@pytest.mark.asyncio
async def test_run_clustering_analysis_empty_tree():
    """Test workflow driver handles empty tree gracefully"""
    empty_tree = {}
    
    with patch('backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver._format_nodes_for_prompt') as mock_format, \
         patch('backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver.ClusteringAgent') as mock_agent_class:
        
        mock_format.return_value = "No nodes available"
        mock_agent_instance = Mock()
        mock_agent_instance.run = AsyncMock(return_value=ClusteringResponse(clusters=[]))
        mock_agent_class.return_value = mock_agent_instance
        
        # Should not raise exception
        await run_clustering_analysis(empty_tree)
        
        # Verify it still called the components
        mock_format.assert_called_once_with([], empty_tree)
        mock_agent_instance.run.assert_called_once_with("No nodes available", 0)