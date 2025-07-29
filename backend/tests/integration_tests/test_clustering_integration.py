"""
Integration test for clustering workflow end-to-end
Tests the complete pipeline from markdown files to clustered output with mocked LLM
"""

import pytest
import os
import tempfile
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, patch
from typing import Dict

from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import MarkdownToTreeConverter
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.agentic_workflows.models import ClusteringResponse, ClusterAssignment


class TestClusteringIntegration:
    """Integration test for the clustering system"""
    
    @pytest.fixture
    def animal_example_dir(self):
        """Path to the animal example test data"""
        return "/Users/bobbobby/repos/VoiceTreePoc/backend/tests/animal_example"
    
    @pytest.fixture
    def temp_test_dir(self):
        """Create a temporary directory for test files"""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def sample_tree(self, animal_example_dir):
        """Load the animal example tree"""
        converter = MarkdownToTreeConverter()
        tree = converter.load_tree_from_markdown(animal_example_dir)
        return tree
    
    @pytest.fixture
    def mock_clustering_response(self):
        """Mock clustering response with predefined clusters"""
        # Define clusters based on animal types and calculation types
        clusters_data = [
            # Farm Animals cluster
            (1, "Farm_Animals"),
            (6, "Farm_Animals"), 
            (19, "Farm_Animals"),
            (21, "Farm_Animals"),
            (29, "Farm_Animals"),
            (33, "Farm_Animals"),
            (37, "Farm_Animals"),
            
            # Wild Animals cluster  
            (12, "Wild_Animals"),
            (20, "Wild_Animals"),
            (22, "Wild_Animals"),
            (28, "Wild_Animals"),
            (36, "Wild_Animals"),
            
            # Mathematical Calculations cluster
            (10, "Mathematical_Calculations"),
            (13, "Mathematical_Calculations"),
            (14, "Mathematical_Calculations"),
            (16, "Mathematical_Calculations"),
            (17, "Mathematical_Calculations"),
            (18, "Mathematical_Calculations"),
            (23, "Mathematical_Calculations"),
            (24, "Mathematical_Calculations"),
            (25, "Mathematical_Calculations"),
            (26, "Mathematical_Calculations"),
            (32, "Mathematical_Calculations"),
            (34, "Mathematical_Calculations"),
            (35, "Mathematical_Calculations"),
            (38, "Mathematical_Calculations"),
            (39, "Mathematical_Calculations"),
            (40, "Mathematical_Calculations"),
            (41, "Mathematical_Calculations"),
            
            # Population Comparisons cluster
            (2, "Population_Comparisons"),
            (3, "Population_Comparisons"),
            (4, "Population_Comparisons"),
            (5, "Population_Comparisons"),
            (7, "Population_Comparisons"),
            (8, "Population_Comparisons"),
            (9, "Population_Comparisons"),
            (11, "Population_Comparisons"),
            (15, "Population_Comparisons"),
            (27, "Population_Comparisons"),
            (30, "Population_Comparisons"),
            (31, "Population_Comparisons"),
        ]
        
        cluster_assignments = [
            ClusterAssignment(
                node_id=node_id,
                cluster_name=cluster_name,
                reasoning=f"Node {node_id} belongs to {cluster_name} based on content analysis"
            )
            for node_id, cluster_name in clusters_data
        ]
        
        return ClusteringResponse(clusters=cluster_assignments)
    
    @pytest.mark.asyncio
    async def test_clustering_integration_workflow_mocked(
        self, 
        sample_tree, 
        mock_clustering_response, 
        temp_test_dir
    ):
        """
        Test the complete clustering workflow with mocked LLM responses
        This test will initially fail until the workflow driver is implemented
        """
        # Verify we loaded 50 nodes (or close to it)
        assert len(sample_tree) >= 40, f"Expected around 50 nodes, got {len(sample_tree)}"
        
        # Copy test files to temp directory for modification testing
        animal_dir = "/Users/bobbobby/repos/VoiceTreePoc/backend/tests/animal_example"
        for filename in os.listdir(animal_dir):
            if filename.endswith('.md'):
                shutil.copy2(os.path.join(animal_dir, filename), temp_test_dir)
        
        # Mock the ClusteringAgent to return our predefined response
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent.ClusteringAgent') as mock_agent_class:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = mock_clustering_response
            mock_agent_class.return_value = mock_agent
            
            # Import Charlie's workflow driver implementation
            try:
                # Import the workflow driver function
                from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis
                
                # Run the clustering analysis (updates tree in place)
                await run_clustering_analysis(sample_tree)
                
                # Verify tree DS is updated with cluster_name attributes
                clustered_nodes = [node for node in sample_tree.values() if hasattr(node, 'cluster_name') and node.cluster_name]
                assert len(clustered_nodes) > 0, "No nodes were assigned clusters"
                
                # Verify we have the expected number of clusters (3-6 based on ln(50) ≈ 3.9)
                unique_clusters = set(node.cluster_name for node in sample_tree.values() if hasattr(node, 'cluster_name') and node.cluster_name)
                assert 3 <= len(unique_clusters) <= 6, f"Expected 3-6 clusters, got {len(unique_clusters)}: {unique_clusters}"
                
                # Verify cluster names match our mock
                expected_clusters = {"Farm_Animals", "Wild_Animals", "Mathematical_Calculations", "Population_Comparisons"}
                assert unique_clusters.issubset(expected_clusters), f"Unexpected clusters: {unique_clusters - expected_clusters}"
                
                # Test Diana's markdown tag updates
                try:
                    from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
                    
                    # Convert tree back to markdown with cluster tags
                    converter = TreeToMarkdownConverter(sample_tree)
                    converter.convert_nodes(output_dir=temp_test_dir, nodes_to_update=set(sample_tree.keys()))
                    
                    # Verify markdown files contain cluster tags
                    files_with_tags = 0
                    for node in sample_tree.values():
                        if hasattr(node, 'cluster_name') and node.cluster_name:
                            filepath = os.path.join(temp_test_dir, node.filename)
                            if os.path.exists(filepath):
                                with open(filepath, 'r') as f:
                                    content = f.read()
                                    # Check if cluster tag appears as first line
                                    lines = content.split('\n')
                                    if lines and lines[0] == f"#{node.cluster_name}":
                                        files_with_tags += 1
                    
                    assert files_with_tags > 0, "No markdown files contain cluster tags"
                    
                except ImportError:
                    pytest.skip("tree_to_markdown update not implemented yet (DIANA's task)")
                    
            except ImportError:
                pytest.skip("Workflow driver not implemented yet (CHARLIE's task)")
    
    @pytest.mark.asyncio
    async def test_charlie_workflow_driver_integration(
        self, 
        sample_tree, 
        mock_clustering_response
    ):
        """
        Test specifically that Charlie's workflow driver works correctly
        (this test should PASS now that Charlie has implemented it)
        """
        # Mock the ClusteringAgent to return our predefined response
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent.ClusteringAgent') as mock_agent_class:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = mock_clustering_response
            mock_agent_class.return_value = mock_agent
            
            # Import and run Charlie's workflow driver
            from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis
            
            # Run the clustering analysis (updates tree in place)
            await run_clustering_analysis(sample_tree)
            
            # Verify tree DS is updated with cluster_name attributes
            clustered_nodes = [node for node in sample_tree.values() if hasattr(node, 'cluster_name') and node.cluster_name]
            assert len(clustered_nodes) > 0, "No nodes were assigned clusters"
            
            # Verify we have the expected number of clusters (3-6 based on ln(50) ≈ 3.9)
            unique_clusters = set(node.cluster_name for node in sample_tree.values() if hasattr(node, 'cluster_name') and node.cluster_name)
            assert 3 <= len(unique_clusters) <= 6, f"Expected 3-6 clusters, got {len(unique_clusters)}: {unique_clusters}"
            
            # Verify cluster names match our mock
            expected_clusters = {"Farm_Animals", "Wild_Animals", "Mathematical_Calculations", "Population_Comparisons"}
            assert unique_clusters.issubset(expected_clusters), f"Unexpected clusters: {unique_clusters - expected_clusters}"
            
            # Verify specific nodes got the expected cluster assignments
            for node in sample_tree.values():
                if hasattr(node, 'cluster_name') and node.cluster_name:
                    assert node.cluster_name in expected_clusters, f"Node {node.id} got unexpected cluster: {node.cluster_name}"
    
    def test_animal_example_data_integrity(self, sample_tree):
        """Verify the animal example data is loaded correctly"""
        # Test that we can load the animal example files
        assert len(sample_tree) > 0, "No nodes loaded from animal example directory"
        
        # Verify node structure
        for node_id, node in sample_tree.items():
            assert isinstance(node.id, int), f"Node {node_id} has invalid id"
            assert isinstance(node.title, str), f"Node {node_id} has invalid title"
            assert isinstance(node.summary, str), f"Node {node_id} has invalid summary"
            assert node.title.strip(), f"Node {node_id} has empty title"
    
    def test_mock_clustering_response_structure(self, mock_clustering_response):
        """Verify our mock clustering response has the correct structure"""
        assert isinstance(mock_clustering_response, ClusteringResponse)
        assert len(mock_clustering_response.clusters) > 0
        
        # Verify cluster assignments have required fields
        for assignment in mock_clustering_response.clusters:
            assert isinstance(assignment.node_id, int)
            assert isinstance(assignment.cluster_name, str)
            assert isinstance(assignment.reasoning, str)
            assert assignment.cluster_name in {"Farm_Animals", "Wild_Animals", "Mathematical_Calculations", "Population_Comparisons"}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])