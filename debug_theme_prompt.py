#!/usr/bin/env python3
"""
Debug the exact prompt sent to the LLM for theme identification
"""

import asyncio
import sys
import json

sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_repository_for_themes
from text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt
from text_to_graph_pipeline.agentic_workflows.agents.theme_identification_agent import ThemeIdentificationAgent
from text_to_graph_pipeline.agentic_workflows.theme_identification_workflow_driver import ThemeIdentificationWorkflow


async def main():
    # Test with VoiceTree subset first
    input_forest_path = "/tmp/voicetree_theme_test"
    
    print("🔍 Debug: Loading VoiceTree subset...")
    
    # Load tree
    tree = load_markdown_repository_for_themes(input_forest_path)
    nodes = list(tree.values())
    
    print(f"📊 Loaded {len(nodes)} nodes")
    
    # Show all nodes with their exact titles
    print("\n📋 All nodes with exact titles:")
    for node in nodes:
        print(f"  Node {node.id}: \"{node.title}\"")
    
    # Format for LLM
    formatted = _format_nodes_for_prompt(nodes, tree)
    
    print(f"\n📄 Formatted prompt length: {len(formatted)} characters")
    print("\n🔍 FULL FORMATTED PROMPT SENT TO LLM:")
    print("=" * 80)
    print(formatted)
    print("=" * 80)
    
    # Calculate num_themes
    num_themes = max(2, min(5, len(nodes) // 2))
    print(f"\n🎯 Number of themes to identify: {num_themes}")
    
    # Create mapping from titles to IDs
    title_to_id = {node.title: node.id for node in nodes}
    print("\n📋 Title to ID mapping:")
    for title, node_id in title_to_id.items():
        print(f"  \"{title}\" -> {node_id}")
    
    # Run the theme identification agent directly
    print("\n🚀 Running theme identification agent...")
    theme_agent = ThemeIdentificationAgent()
    theme_response = await theme_agent.run(formatted, num_themes)
    
    print("\n📊 THEME RESPONSE FROM LLM:")
    print(json.dumps(theme_response.model_dump(), indent=2))
    
    # Check which node names were returned
    print("\n🔍 Node names returned by LLM:")
    for theme in theme_response.themes:
        print(f"\n  Theme: {theme.theme_name}")
        for node_name in theme.node_names:
            if node_name in title_to_id:
                print(f"    ✅ \"{node_name}\" -> Found (ID: {title_to_id[node_name]})")
            else:
                print(f"    ❌ \"{node_name}\" -> NOT FOUND in actual nodes!")
    
    # Also run the full workflow to see the complete process
    print("\n\n🔄 Running full workflow...")
    workflow = ThemeIdentificationWorkflow()
    result = await workflow.identify_themes(input_forest_path, write_colors=False)
    
    print("\n📊 WORKFLOW RESULT:")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())