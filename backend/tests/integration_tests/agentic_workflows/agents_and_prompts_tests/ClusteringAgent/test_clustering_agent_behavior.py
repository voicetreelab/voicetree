"""
Behavioral test for ClusteringAgent
Tests the agent's ability to cluster nodes by semantic similarity
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt
from backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent import ClusteringAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import ClusteringResponse, ClusterAssignment


@pytest.mark.asyncio
class TestClusteringAgentBehavior:
    """Test clustering agent behavioral patterns"""

    @pytest.fixture
    def sample_nodes(self) -> List[Node]:
        """Create sample nodes with clear semantic groupings"""
        return [
            Node(name="Dogs", node_id=1, content="Dogs are loyal pets...", summary="Information about domestic dogs and their breeds"),
            Node(name="Cats", node_id=2, content="Cats are independent pets...", summary="Overview of domestic cats and feline behavior"),
            Node(name="Oak Trees", node_id=3, content="Oak trees are large...", summary="Deciduous trees common in temperate regions"),
            Node(name="Maple Trees", node_id=4, content="Maple trees produce...", summary="Tree species known for colorful autumn leaves"),
            Node(name="Python Programming", node_id=5, content="Python is versatile...", summary="High-level programming language for software development"),
            Node(name="JavaScript", node_id=6, content="JavaScript runs in browsers...", summary="Programming language for web development"),
            Node(name="Random Topic", node_id=7, content="This doesn't fit anywhere...", summary="Something completely unrelated to other nodes"),
        ]

    @pytest.fixture
    def clustering_agent(self) -> ClusteringAgent:
        """Create clustering agent instance"""
        return ClusteringAgent()

    async def test_clusters_semantically_similar_nodes(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent groups semantically similar nodes together"""
        # Format nodes for prompt
        formatted_nodes = _format_nodes_for_prompt(sample_nodes)
        
        # Run clustering
        result: ClusteringResponse = await clustering_agent.run(formatted_nodes, len(sample_nodes))
        
        # Verify structure
        assert isinstance(result, ClusteringResponse)
        assert len(result.clusters) == len(sample_nodes)
        
        # Get clusters by name
        clusters_by_name = {}
        for assignment in result.clusters:
            assert isinstance(assignment, ClusterAssignment)
            if assignment.cluster_name:
                if assignment.cluster_name not in clusters_by_name:
                    clusters_by_name[assignment.cluster_name] = []
                clusters_by_name[assignment.cluster_name].append(assignment.node_id)
        
        # Should have approximately ln(7) ≈ 2-3 clusters
        assert 2 <= len(clusters_by_name) <= 4
        
        # Verify semantic groupings exist
        node_assignments = {assignment.node_id: assignment.cluster_name for assignment in result.clusters}
        
        # Dogs and Cats should likely be in same cluster (pets/animals)
        dogs_cluster = node_assignments[1]
        cats_cluster = node_assignments[2]
        if dogs_cluster and cats_cluster:  # If both are clustered
            assert dogs_cluster == cats_cluster, "Dogs and cats should be in same cluster"
        
        # Oak and Maple trees should likely be in same cluster
        oak_cluster = node_assignments[3]
        maple_cluster = node_assignments[4]
        if oak_cluster and maple_cluster:  # If both are clustered
            assert oak_cluster == maple_cluster, "Oak and maple trees should be in same cluster"
        
        # Programming languages should likely be in same cluster
        python_cluster = node_assignments[5]
        js_cluster = node_assignments[6]
        if python_cluster and js_cluster:  # If both are clustered
            assert python_cluster == js_cluster, "Python and JavaScript should be in same cluster"

    async def test_handles_unclustered_nodes(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent can mark nodes as unclustered when they don't fit"""
        formatted_nodes = _format_nodes_for_prompt(sample_nodes)
        
        result: ClusteringResponse = await clustering_agent.run(formatted_nodes, len(sample_nodes))
        
        # Random topic node should potentially be unclustered
        random_topic_assignment = next(a for a in result.clusters if a.node_id == 7)
        # It's okay if it gets clustered or not, but test that None is handled
        assert random_topic_assignment.cluster_name is None or isinstance(random_topic_assignment.cluster_name, str)

    async def test_provides_reasoning(self, clustering_agent: ClusteringAgent, sample_nodes: List[Node]):
        """Test that agent provides reasoning for clustering decisions"""
        formatted_nodes = _format_nodes_for_prompt(sample_nodes[:3])  # Use fewer nodes
        
        result: ClusteringResponse = await clustering_agent.run(formatted_nodes, 3)
        
        for assignment in result.clusters:
            assert assignment.reasoning is not None
            assert len(assignment.reasoning) > 10  # Should be meaningful reasoning

    async def test_with_small_node_count(self, clustering_agent: ClusteringAgent):
        """Test behavior with minimal nodes"""
        nodes = [
            Node(name="Single Topic", node_id=1, content="Alone...", summary="Only node available"),
        ]
        formatted_nodes = _format_nodes_for_prompt(nodes)
        
        result: ClusteringResponse = await clustering_agent.run(formatted_nodes, 1)
        
        assert len(result.clusters) == 1
        # Single node might be unclustered or in its own cluster
        assignment = result.clusters[0]
        assert assignment.node_id == 1
        assert assignment.reasoning is not None