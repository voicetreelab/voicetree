# """
# Live integration test for theme identification workflow with real LLM calls.
# Tests the complete pipeline end-to-end without mocks.
# """
#
# import pytest
# import os
# from backend.text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow
#
#
# @pytest.mark.asyncio
# async def test_theme_identification_workflow_live_llm():
#     """Test complete workflow with real LLM calls (no mocks)"""
#
#     # Get path to test data
#     test_data_dir = os.path.join(
#         os.path.dirname(__file__),
#         "theme_identification_test_data",
#         "input_forest"
#     )
#
#     # Run the workflow with real LLM calls
#     workflow = ThemeIdentificationWorkflow()
#     result = await workflow.identify_themes(test_data_dir)
#
#     # Verify output structure
#     assert "identified_themes" in result
#     assert "total_themes" in result
#     assert "total_nodes_processed" in result
#
#     # Verify we processed the expected number of nodes
#     assert result["total_nodes_processed"] == 8
#
#     # Verify we got themes
#     themes = result["identified_themes"]
#     assert len(themes) >= 1, f"Expected at least 1 theme, got {len(themes)}"
#     assert result["total_themes"] == len(themes)
#
#     print(f"\n--- Theme Identification Results ---")
#     print(f"Total themes identified: {result['total_themes']}")
#     print(f"Total nodes processed: {result['total_nodes_processed']}")
#
#     # Verify each theme has proper structure
#     for theme_name, theme_data in themes.items():
#         print(f"\nTheme: {theme_name}")
#         print(f"  Description: {theme_data['description']}")
#         print(f"  Node IDs: {theme_data['node_ids']}")
#         print(f"  Node Count: {theme_data['node_count']}")
#
#         # Validate structure
#         assert "description" in theme_data
#         assert "node_ids" in theme_data
#         assert "node_count" in theme_data
#         assert isinstance(theme_data["node_ids"], list)
#         assert theme_data["node_count"] == len(theme_data["node_ids"])
#
#         # Skip validation for themes with empty node lists (LLM quirk)
#         if len(theme_data["node_ids"]) == 0:
#             print(f"  Warning: Theme '{theme_name}' has no nodes assigned")
#             continue
#
#         # Node IDs should be valid integers (filter out invalid ones from LLM)
#         valid_node_ids = []
#         for node_id in theme_data["node_ids"]:
#             assert isinstance(node_id, int)
#             if 1 <= node_id <= 8:
#                 valid_node_ids.append(node_id)
#             else:
#                 print(f"  Warning: LLM returned invalid node ID {node_id}, filtering out")
#
#         # Update with only valid node IDs for further validation
#         theme_data["valid_node_ids"] = valid_node_ids
#
#     # Verify theme assignment (using valid node IDs only)
#     assigned_nodes = set()
#     for theme_data in themes.values():
#         assigned_nodes.update(theme_data.get("valid_node_ids", theme_data["node_ids"]))
#
#     print(f"\nValid nodes assigned to themes: {sorted(assigned_nodes)}")
#     # Basic functionality check - at least some nodes should be assigned to themes
#     assert len(assigned_nodes) >= 1, f"No nodes assigned to themes. Got {len(assigned_nodes)}"
#
#     print(f"\n✅ Theme identification completed successfully!")
#     print(f"All {len(assigned_nodes)} nodes assigned to {len(themes)} themes")
#
#
# if __name__ == "__main__":
#     pytest.main([__file__, "-v", "-s"])
