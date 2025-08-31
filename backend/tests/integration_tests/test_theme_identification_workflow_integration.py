# """
# Integration test for the theme identification workflow driver.
#
# Tests the complete workflow orchestration including loading, formatting, and theme identification.
# Mocks the agent response to test workflow behavior.
# """
#
# import pytest
# from unittest.mock import Mock, patch, AsyncMock
# import os
# from backend.text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow
# from backend.text_to_graph_pipeline.agentic_workflows.models import Theme, ThemeResponse
#
#
# @pytest.mark.asyncio
# async def test_theme_identification_workflow_integration():
#     """Test complete workflow orchestration with mocked agent"""
#
#     # Get path to test data
#     test_data_dir = os.path.join(os.path.dirname(__file__), "theme_identification_test_data", "input_forest")
#
#     # Mock agent response matching expected themes from test data
#     mock_themes = [
#         Theme(
#             theme_name="API Development",
#             theme_description="REST API endpoints and authentication",
#             node_ids=[1, 2, 3],
#             confidence=0.90
#         ),
#         Theme(
#             theme_name="Database Management",
#             theme_description="Database schema and migration handling",
#             node_ids=[4, 5],
#             confidence=0.85
#         ),
#         Theme(
#             theme_name="Testing Infrastructure",
#             theme_description="Unit and integration testing frameworks",
#             node_ids=[6, 7],
#             confidence=0.88
#         ),
#         Theme(
#             theme_name="Frontend Development",
#             theme_description="React components and UI implementation",
#             node_ids=[8],
#             confidence=0.80
#         )
#     ]
#
#     mock_response = ThemeResponse(themes=mock_themes)
#
#     # Mock the ThemeIdentificationAgent
#     with patch('backend.text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver.ThemeIdentificationAgent') as mock_agent_class:
#         mock_agent = AsyncMock()
#         mock_agent.run.return_value = mock_response
#         mock_agent_class.return_value = mock_agent
#
#         # Run the workflow
#         workflow = ThemeIdentificationWorkflow()
#         result = await workflow.identify_themes(test_data_dir)
#
#         # Verify the agent was called correctly with both parameters
#         mock_agent.run.assert_called_once()
#         call_args = mock_agent.run.call_args[0]
#
#         # Get the arguments that were passed to the agent
#         formatted_nodes_arg = call_args[0]
#         num_themes_arg = call_args[1]
#
#         # Verify the formatted nodes contain expected structure
#         assert "===== Available Nodes =====" in formatted_nodes_arg
#         assert "Node ID:" in formatted_nodes_arg
#         assert "Title:" in formatted_nodes_arg
#         assert "Summary:" in formatted_nodes_arg
#
#         # Verify num_themes parameter is reasonable
#         assert isinstance(num_themes_arg, int)
#         assert 2 <= num_themes_arg <= 5
#
#         # Verify output structure matches expected format
#         assert "identified_themes" in result
#         assert "total_themes" in result
#         assert "total_nodes_processed" in result
#
#         # Verify theme structure
#         themes = result["identified_themes"]
#         assert len(themes) == 4
#         assert "API Development" in themes
#         assert "Database Management" in themes
#         assert "Testing Infrastructure" in themes
#         assert "Frontend Development" in themes
#
#         # Verify theme details
#         api_theme = themes["API Development"]
#         assert api_theme["description"] == "REST API endpoints and authentication"
#         assert api_theme["node_ids"] == [1, 2, 3]
#         assert api_theme["node_count"] == 3
#
#         # Verify totals
#         assert result["total_themes"] == 4
#         assert result["total_nodes_processed"] == 8
#
#
# @pytest.mark.asyncio
# async def test_theme_identification_workflow_empty_forest():
#     """Test workflow handles empty input forest gracefully"""
#
#     # Create temporary empty directory
#     import tempfile
#     with tempfile.TemporaryDirectory() as temp_dir:
#
#         # Mock agent response for empty case
#         mock_response = ThemeResponse(themes=[])
#
#         with patch('backend.text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver.ThemeIdentificationAgent') as mock_agent_class:
#             mock_agent = AsyncMock()
#             mock_agent.run.return_value = mock_response
#             mock_agent_class.return_value = mock_agent
#
#             workflow = ThemeIdentificationWorkflow()
#             result = await workflow.identify_themes(temp_dir)
#
#             # Verify empty result structure
#             assert result["identified_themes"] == {}
#             assert result["total_themes"] == 0
#             assert result["total_nodes_processed"] == 0