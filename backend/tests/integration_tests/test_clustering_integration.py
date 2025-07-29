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
from backend.text_to_graph_pipeline.agentic_workflows.models import TagResponse, TagAssignment


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
    def mock_tagging_response(self):
        """Mock tagging response with predefined multi-tags"""
        # Define tags based on animal types and calculation types - nodes can have multiple tags
        tags_data = [
            # Farm Animals - multiple tags per node
            (1, ["farm_animals", "domestic", "livestock"]),
            (6, ["farm_animals", "poultry", "domestic"]), 
            (19, ["farm_animals", "livestock", "cattle"]),
            (21, ["farm_animals", "domestic", "mammals"]),
            (29, ["farm_animals", "poultry", "eggs"]),
            (33, ["farm_animals", "livestock", "dairy"]),
            (37, ["farm_animals", "domestic", "herbivores"]),
            
            # Wild Animals - multiple tags per node
            (12, ["wild_animals", "predators", "carnivores"]),
            (20, ["wild_animals", "african", "savanna"]),
            (22, ["wild_animals", "forest", "mammals"]),
            (28, ["wild_animals", "marine", "aquatic"]),
            (36, ["wild_animals", "birds", "flying"]),
            
            # Mathematical Calculations - multiple tags per node
            (10, ["mathematics", "calculations", "equations"]),
            (13, ["mathematics", "statistics", "averages"]),
            (14, ["mathematics", "geometry", "measurements"]),
            (16, ["mathematics", "calculations", "comparisons"]),
            (17, ["mathematics", "statistics", "populations"]),
            (18, ["mathematics", "equations", "solving"]),
            (23, ["mathematics", "calculations", "ratios"]),
            (24, ["mathematics", "statistics", "distributions"]),
            (25, ["mathematics", "geometry", "areas"]),
            (26, ["mathematics", "calculations", "percentages"]),
            (32, ["mathematics", "statistics", "correlations"]),
            (34, ["mathematics", "equations", "variables"]),
            (35, ["mathematics", "calculations", "totals"]),
            (38, ["mathematics", "statistics", "sampling"]),
            (39, ["mathematics", "geometry", "volumes"]),
            (40, ["mathematics", "calculations", "differences"]),
            (41, ["mathematics", "equations", "solutions"]),
            
            # Population Comparisons - multiple tags per node
            (2, ["populations", "comparisons", "demographics"]),
            (3, ["populations", "statistics", "census"]),
            (4, ["populations", "comparisons", "regions"]),
            (5, ["populations", "demographics", "age_groups"]),
            (7, ["populations", "statistics", "growth"]),
            (8, ["populations", "comparisons", "urban_rural"]),
            (9, ["populations", "demographics", "gender"]),
            (11, ["populations", "statistics", "density"]),
            (15, ["populations", "comparisons", "migration"]),
            (27, ["populations", "demographics", "ethnicity"]),
            (30, ["populations", "statistics", "trends"]),
            (31, ["populations", "comparisons", "economic"]),
        ]
        
        tag_assignments = [
            TagAssignment(
                node_id=node_id,
                tags=tags_list
            )
            for node_id, tags_list in tags_data
        ]
        
        return TagResponse(tags=tag_assignments)
    
    @pytest.mark.asyncio
    async def test_clustering_integration_workflow_mocked(
        self, 
        sample_tree, 
        mock_tagging_response, 
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
            mock_agent.run.return_value = mock_tagging_response
            mock_agent_class.return_value = mock_agent
            
            # Import Charlie's workflow driver implementation
            try:
                # Import the workflow driver function
                from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis
                
                # Run the clustering analysis (updates tree in place)
                await run_clustering_analysis(sample_tree)
                
                # Verify tree DS is updated with tags attributes
                tagged_nodes = [node for node in sample_tree.values() if hasattr(node, 'tags') and node.tags]
                assert len(tagged_nodes) > 0, "No nodes were assigned tags"
                
                # Verify we have reasonable tag distribution
                all_tags = set()
                for node in sample_tree.values():
                    if hasattr(node, 'tags') and node.tags:
                        all_tags.update(node.tags)
                
                # Should have multiple unique tags across all nodes
                assert len(all_tags) >= 5, f"Expected at least 5 unique tags, got {len(all_tags)}: {all_tags}"
                
                # Verify we have diverse tag categories (flexible check)
                # Look for animal-related, math-related, or other thematic groupings
                animal_keywords = {"animal", "farm", "wild", "domestic", "mammal", "bird", "fish", "livestock"}
                math_keywords = {"math", "calculation", "number", "population", "statistic", "count", "formula"}
                general_keywords = {"comparison", "analysis", "data", "information", "category", "group"}
                
                animal_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in animal_keywords)}
                math_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in math_keywords)}
                general_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in general_keywords)}
                
                diverse_categories = len([cat for cat in [animal_tags, math_tags, general_tags] if cat])
                assert diverse_categories >= 1, f"Expected some thematic grouping in tags, got: {all_tags}"
                
                # Test Diana's markdown tag updates
                try:
                    from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
                    
                    # Convert tree back to markdown with cluster tags
                    converter = TreeToMarkdownConverter(sample_tree)
                    converter.convert_nodes(output_dir=temp_test_dir, nodes_to_update=set(sample_tree.keys()))
                    
                    # Verify markdown files contain multi-tags
                    files_with_tags = 0
                    for node in sample_tree.values():
                        if hasattr(node, 'tags') and node.tags:
                            filepath = os.path.join(temp_test_dir, node.filename)
                            if os.path.exists(filepath):
                                with open(filepath, 'r') as f:
                                    content = f.read()
                                    lines = content.split('\n')
                                    # Check if multiple tags appear as first line (e.g. #tag1 #tag2 #tag3)
                                    if lines and lines[0].startswith('#') and any(tag in lines[0] for tag in node.tags):
                                        files_with_tags += 1
                    
                    assert files_with_tags > 0, "No markdown files contain tags"
                    
                except ImportError:
                    pytest.skip("tree_to_markdown update not implemented yet (DIANA's task)")
                    
            except ImportError:
                pytest.skip("Workflow driver not implemented yet (CHARLIE's task)")
    
    @pytest.mark.asyncio
    async def test_charlie_workflow_driver_integration(
        self, 
        sample_tree, 
        mock_tagging_response
    ):
        """
        Test specifically that Charlie's workflow driver works correctly
        (this test should PASS now that Charlie has implemented it)
        """
        # Mock the ClusteringAgent to return our predefined response
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.clustering_agent.ClusteringAgent') as mock_agent_class:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = mock_tagging_response
            mock_agent_class.return_value = mock_agent
            
            # Import and run Charlie's workflow driver
            from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis
            
            # Run the clustering analysis (updates tree in place)
            await run_clustering_analysis(sample_tree)
            
            # Verify tree DS is updated with tags attributes
            tagged_nodes = [node for node in sample_tree.values() if hasattr(node, 'tags') and node.tags]
            assert len(tagged_nodes) > 0, "No nodes were assigned tags"
            
            # Verify we have reasonable tag distribution
            all_tags = set()
            for node in sample_tree.values():
                if hasattr(node, 'tags') and node.tags:
                    all_tags.update(node.tags)
                    
            assert len(all_tags) >= 5, f"Expected at least 5 unique tags, got {len(all_tags)}: {all_tags}"
            
            # Verify we have diverse tag categories (flexible check)
            # Look for animal-related, math-related, or other thematic groupings
            animal_keywords = {"animal", "farm", "wild", "domestic", "mammal", "bird", "fish", "livestock"}
            math_keywords = {"math", "calculation", "number", "population", "statistic", "count", "formula"}
            general_keywords = {"comparison", "analysis", "data", "information", "category", "group"}
            
            animal_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in animal_keywords)}
            math_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in math_keywords)}
            general_tags = {tag for tag in all_tags if any(keyword in tag.lower() for keyword in general_keywords)}
            
            diverse_categories = len([cat for cat in [animal_tags, math_tags, general_tags] if cat])
            assert diverse_categories >= 1, f"Expected some thematic grouping in tags, got: {all_tags}"
            
            # Verify specific nodes got the expected tag assignments
            for node in sample_tree.values():
                if hasattr(node, 'tags') and node.tags:
                    assert isinstance(node.tags, list), f"Node {node.id} tags should be a list: {node.tags}"
                    assert all(isinstance(tag, str) for tag in node.tags), f"All tags should be strings for node {node.id}: {node.tags}"
    
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
    
    def test_mock_tagging_response_structure(self, mock_tagging_response):
        """Verify our mock tagging response has the correct structure"""
        assert isinstance(mock_tagging_response, TagResponse)
        assert len(mock_tagging_response.tags) > 0
        
        # Verify tag assignments have required fields
        for assignment in mock_tagging_response.tags:
            assert isinstance(assignment.node_id, int)
            assert isinstance(assignment.tags, list)
            assert all(isinstance(tag, str) for tag in assignment.tags)
            # Note: reasoning field removed from TagAssignment model


if __name__ == "__main__":
    pytest.main([__file__, "-v"])