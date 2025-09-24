# """
# Integration test for theme identification workflow end-to-end
# Tests the complete pipeline from markdown files to theme identification with mocked LLM
# """
#
# import pytest
# import os
# import tempfile
# import shutil
# from pathlib import Path
# from unittest.mock import AsyncMock, patch
# from typing import Dict
#
# from backend.markdown_tree_manager.markdown_to_tree import MarkdownToTreeConverter
# from backend.markdown_tree_manager.markdown_tree_ds import Node
#
#
# class TestThemeIdentificationIntegration:
#     """Integration test for the theme identification system"""
#
#     @pytest.fixture
#     def theme_test_data_dir(self):
#         """Path to the theme identification test data"""
#         return "/Users/bobbobby/repos/VoiceTree/backend/tests/integration_tests/theme_identification_test_data/input_forest"
#
#     @pytest.fixture
#     def sample_tree(self, theme_test_data_dir):
#         """Load the theme test data tree"""
#         converter = MarkdownToTreeConverter()
#         tree = converter.load_tree_from_markdown(theme_test_data_dir)
#         return tree
#
#     @pytest.fixture
#     def mock_theme_identification_response(self):
#         """Mock theme identification response with expected themes"""
#         # Import will only work once Alice implements the models
#         try:
#             from backend.text_to_graph_pipeline.agentic_workflows.models import Theme, ThemeResponse
#
#             themes = [
#                 Theme(
#                     theme_name="API Design",
#                     theme_description="REST API endpoints and authentication",
#                     node_ids=[2, 3],
#                     confidence=0.92
#                 ),
#                 Theme(
#                     theme_name="Database Management",
#                     theme_description="Database schema and migration strategy",
#                     node_ids=[4, 5],
#                     confidence=0.88
#                 ),
#                 Theme(
#                     theme_name="Testing Framework",
#                     theme_description="Unit and integration testing approaches",
#                     node_ids=[6, 7],
#                     confidence=0.85
#                 ),
#                 Theme(
#                     theme_name="User Interface",
#                     theme_description="React component architecture",
#                     node_ids=[8],
#                     confidence=0.90
#                 )
#             ]
#
#             return ThemeResponse(themes=themes)
#
#         except ImportError:
#             # Fallback mock structure if models aren't implemented yet
#             return {
#                 "themes": [
#                     {
#                         "theme_name": "API Design",
#                         "theme_description": "REST API endpoints and authentication",
#                         "node_ids": [2, 3],
#                         "confidence": 0.92
#                     },
#                     {
#                         "theme_name": "Database Management",
#                         "theme_description": "Database schema and migration strategy",
#                         "node_ids": [4, 5],
#                         "confidence": 0.88
#                     },
#                     {
#                         "theme_name": "Testing Framework",
#                         "theme_description": "Unit and integration testing approaches",
#                         "node_ids": [6, 7],
#                         "confidence": 0.85
#                     },
#                     {
#                         "theme_name": "User Interface",
#                         "theme_description": "React component architecture",
#                         "node_ids": [8],
#                         "confidence": 0.90
#                     }
#                 ]
#             }
#
#     @pytest.mark.asyncio
#     async def test_theme_identification_integration_workflow(
#         self,
#         sample_tree,
#         mock_theme_identification_response
#     ):
#         """
#         Test the complete theme identification workflow with mocked LLM responses
#         This test will initially fail until all components are implemented
#         """
#         # Verify we loaded the expected number of nodes
#         assert len(sample_tree) == 8, f"Expected 8 nodes, got {len(sample_tree)}"
#
#         # Verify nodes have expected structure
#         for node_id, node in sample_tree.items():
#             assert isinstance(node.id, int)
#             assert isinstance(node.title, str)
#             assert node.title.strip(), f"Node {node_id} has empty title"
#
#         # Test Bob's enhanced loader (removes color metadata)
#         try:
#             # Import Bob's enhanced loader function
#             from backend.markdown_tree_manager.markdown_to_tree import load_markdown_repository_for_themes
#
#             # Load tree using Bob's function
#             cleaned_tree = load_markdown_repository_for_themes(
#                 "/Users/bobbobby/repos/VoiceTree/backend/tests/integration_tests/theme_identification_test_data/input_forest"
#             )
#
#             # Verify colors are removed/None
#             for node in cleaned_tree.values():
#                 assert getattr(node, 'color', None) is None, f"Node {node.id} still has color metadata"
#
#         except ImportError:
#             pytest.skip("Bob's load_markdown_repository_for_themes not implemented yet")
#
#         # Test Dave's workflow driver
#         try:
#             # Import and test Dave's workflow driver
#             from backend.text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow
#
#             # Mock Alice's agent to return our predefined response
#             with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.theme_identification_agent.ThemeIdentificationAgent') as mock_agent_class:
#                 mock_agent = AsyncMock()
#                 mock_agent.run.return_value = mock_theme_identification_response
#                 mock_agent_class.return_value = mock_agent
#
#                 # Create and run workflow with color writing enabled
#                 workflow = ThemeIdentificationWorkflow()
#                 result = await workflow.identify_themes(
#                     input_forest_path="/Users/bobbobby/repos/VoiceTree/backend/tests/integration_tests/theme_identification_test_data/input_forest",
#                     write_colors=True
#                 )
#
#                 # Verify workflow output structure
#                 assert "identified_themes" in result
#                 assert "total_themes" in result
#                 assert "total_nodes_processed" in result
#                 assert "color_assignments" in result, "Should include color assignments when write_colors=True"
#
#                 # Verify we got expected themes
#                 themes = result["identified_themes"]
#                 assert len(themes) >= 2, f"Expected at least 2 themes, got {len(themes)}"
#
#                 # Verify theme structure
#                 for theme_name, theme_data in themes.items():
#                     assert "description" in theme_data
#                     assert "node_ids" in theme_data
#                     assert "node_count" in theme_data
#                     assert isinstance(theme_data["node_ids"], list)
#                     assert len(theme_data["node_ids"]) > 0
#
#                 # Verify we have meaningful theme groupings (flexible validation for real LLM)
#                 theme_names = set(themes.keys())
#                 assert len(theme_names) > 0, "Should have at least one theme"
#
#                 # Verify themes contain multiple nodes (showing actual grouping)
#                 total_nodes_in_themes = sum(theme_data["node_count"] for theme_data in themes.values())
#                 assert total_nodes_in_themes >= 3, f"Expected themes to contain at least 3 nodes total, got {total_nodes_in_themes}"
#
#                 # Verify color assignments were created
#                 color_assignments = result["color_assignments"]
#                 assert len(color_assignments) >= 3, f"Expected color assignments for at least 3 nodes, got {len(color_assignments)}"
#
#                 # Verify markdown files were updated with colors
#                 test_data_dir = "/Users/bobbobby/repos/VoiceTree/backend/tests/integration_tests/theme_identification_test_data/input_forest"
#                 files_with_colors = 0
#                 for filename in os.listdir(test_data_dir):
#                     if filename.endswith('.md'):
#                         filepath = os.path.join(test_data_dir, filename)
#                         with open(filepath, 'r') as f:
#                             content = f.read()
#                             if content.startswith('---') and 'color:' in content.split('---')[1]:
#                                 files_with_colors += 1
#
#                 assert files_with_colors >= 3, f"Expected at least 3 markdown files to have color metadata, got {files_with_colors}"
#
#         except ImportError:
#             pytest.skip("Dave's ThemeIdentificationWorkflow not implemented yet")
#
#     def test_theme_test_data_integrity(self, sample_tree):
#         """Verify the theme test data is loaded correctly"""
#         # Test that we can load the theme test files
#         assert len(sample_tree) == 8, "Expected exactly 8 nodes from theme test data"
#
#         # Verify node structure and expected content
#         expected_titles = {
#             1: "Project Overview",
#             2: "API Endpoints Design",
#             3: "API Authentication",
#             4: "Database Schema Design",
#             5: "Database Migrations",
#             6: "Unit Testing Framework",
#             7: "Integration Testing Strategy",
#             8: "React Components Architecture"
#         }
#
#         for node_id, expected_title in expected_titles.items():
#             assert node_id in sample_tree, f"Missing node {node_id}"
#             assert sample_tree[node_id].title == expected_title, f"Node {node_id} title mismatch"
#
#     def test_mock_theme_response_structure(self, mock_theme_identification_response):
#         """Verify our mock theme response has the correct structure"""
#
#         # Handle both proper model response and fallback dict
#         if hasattr(mock_theme_identification_response, 'themes'):
#             themes = mock_theme_identification_response.themes
#         else:
#             themes = mock_theme_identification_response["themes"]
#
#         assert len(themes) == 4, "Expected 4 themes in mock response"
#
#         # Verify each theme has required fields
#         for theme in themes:
#             if hasattr(theme, 'theme_name'):
#                 # Proper model object
#                 assert isinstance(theme.theme_name, str)
#                 assert isinstance(theme.node_ids, list)
#                 assert len(theme.node_ids) > 0
#             else:
#                 # Fallback dict structure
#                 assert "theme_name" in theme
#                 assert "node_ids" in theme
#                 assert isinstance(theme["node_ids"], list)
#                 assert len(theme["node_ids"]) > 0
#
#
# if __name__ == "__main__":
#     pytest.main([__file__, "-v"])
