# import pytest
# from unittest.mock import patch, MagicMock, AsyncMock
# from backend.text_to_graph_pipeline.agentic_workflows.agents.theme_identification_agent import ThemeIdentificationAgent
# from backend.text_to_graph_pipeline.agentic_workflows.models import Theme, ThemeResponse
#
# @pytest.mark.asyncio
# async def test_theme_identification_agent_run():
#     """Test the run method of the ThemeIdentificationAgent."""
#
#     agent = ThemeIdentificationAgent()
#
#     # Mock the response from the compiled graph
#     mock_response = {
#         "theme_identification_response": ThemeResponse(
#             themes=[
#                 Theme(theme_name="Theme 1", theme_description="Description 1", node_ids=[1], confidence=0.9),
#                 Theme(theme_name="Theme 2", theme_description="Description 2", node_ids=[2], confidence=0.8)
#             ]
#         )
#     }
#
#     # Patch the `compile` method to return a mock graph that returns the mock response
#     with patch.object(agent, 'compile') as mock_compile:
#         mock_graph = MagicMock()
#         mock_graph.ainvoke = AsyncMock(return_value=mock_response)
#         mock_compile.return_value = mock_graph
#
#         formatted_nodes = "===== Available Nodes =====\nNode ID: 1\nTitle: Test Node 1\nSummary: Summary 1\n\nNode ID: 2\nTitle: Test Node 2\nSummary: Summary 2"
#         num_themes = 2
#
#         # Run the agent
#         result = await agent.run(formatted_nodes, num_themes)
#
#         # Assertions
#         assert isinstance(result, ThemeResponse)
#         assert len(result.themes) == 2
#         assert result.themes[0].theme_name == "Theme 1"
#         assert result.themes[1].node_ids == [2]
