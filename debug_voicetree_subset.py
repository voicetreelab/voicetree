#!/usr/bin/env python3
"""
Debug what the LLM sees for VoiceTree subset
"""

import asyncio
import sys

sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_repository_for_themes
from text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt


async def main():
    test_path = "/tmp/voicetree_theme_test"
    
    print("🔍 Debug: VoiceTree subset formatting...")
    
    # Load tree
    tree = load_markdown_repository_for_themes(test_path)
    nodes = list(tree.values())
    
    print(f"\n📊 Loaded {len(nodes)} nodes")
    print("\n📋 Node titles:")
    for node in nodes:
        print(f"   • ID {node.id}: {node.title}")
    
    # Format for LLM
    formatted = _format_nodes_for_prompt(nodes, tree)
    
    print(f"\n📄 Formatted prompt preview:")
    print("-" * 60)
    print(formatted[:2000])
    print("-" * 60)
    print(f"\n(Total length: {len(formatted)} characters)")


if __name__ == "__main__":
    asyncio.run(main())