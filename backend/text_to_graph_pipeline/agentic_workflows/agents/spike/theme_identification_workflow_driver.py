# """
# Theme identification workflow driver that orchestrates the complete theme identification pipeline.
#
# Takes a path to input_forest folder and returns structured theme groupings.
# """
#
# from typing import Dict, Any
# from backend.markdown_tree_manager.tree_functions import _format_nodes_for_prompt
# from backend.markdown_tree_manager.markdown_to_tree import load_markdown_repository_for_themes
# from backend.text_to_graph_pipeline.agentic_workflows.agents.theme_identification_agent import ThemeIdentificationAgent
# from backend.markdown_tree_manager.color_writer import write_theme_colors_to_markdown
#
#
# class ThemeIdentificationWorkflow:
#     """Orchestrates the complete theme identification pipeline"""
#
#     async def identify_themes(self, input_forest_path: str, write_colors: bool = True) -> Dict[str, Any]:
#         """
#         Main entry point for theme identification workflow.
#
#         Args:
#             input_forest_path: Path to folder containing markdown files
#             write_colors: Whether to write theme colors back to markdown files (default: True)
#
#         Returns:
#             Dictionary with identified themes and metadata
#         """
#         # Load tree using Bob's loader function
#         tree = load_markdown_repository_for_themes(input_forest_path)
#
#         # Extract nodes as list for formatting
#         nodes = list(tree.values())
#
#         # Create mapping from node titles to node IDs for later conversion
#         title_to_id = {node.title: node.id for node in nodes}
#
#         # Format nodes for LLM using existing function
#         formatted_nodes = _format_nodes_for_prompt(nodes, tree)
#
#         # Initialize and run theme identification agent
#         # Calculate appropriate number of themes (similar to clustering)
#         num_themes = max(2, min(5, len(nodes) // 2))  # Between 2-5 themes based on node count
#         theme_agent = ThemeIdentificationAgent()
#         theme_response = await theme_agent.run(formatted_nodes, num_themes)
#
#         # Structure the final output and convert node names back to IDs
#         identified_themes = {}
#         for theme in theme_response.themes:
#             # Convert node names back to node IDs for color writer compatibility
#             node_ids = []
#             for node_name in theme.node_names:
#                 if node_name in title_to_id:
#                     node_ids.append(title_to_id[node_name])
#                 else:
#                     # Log warning for unmatched node names but continue
#                     print(f"Warning: Node name '{node_name}' not found in loaded nodes")
#
#             identified_themes[theme.theme_name] = {
#                 "description": theme.theme_description,
#                 "node_ids": node_ids,
#                 "node_count": len(node_ids)
#             }
#
#         result = {
#             "identified_themes": identified_themes,
#             "total_themes": len(identified_themes),
#             "total_nodes_processed": len(nodes)
#         }
#
#         # Write theme colors back to markdown files if requested
#         if write_colors:
#             node_color_assignments = write_theme_colors_to_markdown(result, input_forest_path)
#             result["color_assignments"] = node_color_assignments
#
#         return result