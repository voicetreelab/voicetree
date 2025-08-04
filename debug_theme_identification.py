#!/usr/bin/env python3
"""
Debug why theme identification isn't finding themes in INPUT_FOREST
"""

import asyncio
import sys

sys.path.insert(0, '/Users/bobbobby/repos/VoiceTree/backend')

from text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_repository_for_themes
from text_to_graph_pipeline.tree_manager.tree_functions import _format_nodes_for_prompt


async def main():
    input_forest_path = "/Users/bobbobby/repos/VoiceTree/markdownTreeVaultDefault/INPUT_FOREST"
    
    print("🔍 Debug: Loading and formatting nodes...")
    
    # Load tree
    tree = load_markdown_repository_for_themes(input_forest_path)
    nodes = list(tree.values())
    
    print(f"📊 Loaded {len(nodes)} nodes")
    
    # Show sample nodes
    print("\n📋 Sample nodes:")
    for i, node in enumerate(nodes[:5]):
        print(f"\nNode {node.id}: {node.title}")
        print(f"Summary: {node.summary[:100] if node.summary else 'No summary'}...")
    
    # Format for LLM
    formatted = _format_nodes_for_prompt(nodes, tree)
    
    print(f"\n📄 Formatted prompt length: {len(formatted)} characters")
    print("\n🔍 First 1000 characters of formatted prompt:")
    print(formatted[:1000])
    
    # Calculate num_themes
    num_themes = max(2, min(5, len(nodes) // 2))
    print(f"\n🎯 Number of themes to identify: {num_themes}")
    
    # Check node diversity
    print("\n📊 Node title analysis:")
    title_words = set()
    for node in nodes:
        words = node.title.lower().split()
        title_words.update(words)
    
    print(f"   • Total unique words in titles: {len(title_words)}")
    print(f"   • Average words per title: {sum(len(n.title.split()) for n in nodes) / len(nodes):.1f}")
    
    # Look for common patterns
    common_prefixes = {}
    for node in nodes:
        prefix = node.title.split('_')[0] if '_' in node.title else node.title.split()[0]
        common_prefixes[prefix] = common_prefixes.get(prefix, 0) + 1
    
    print("\n📊 Common title prefixes:")
    for prefix, count in sorted(common_prefixes.items(), key=lambda x: x[1], reverse=True)[:10]:
        if count > 1:
            print(f"   • '{prefix}': {count} nodes")


if __name__ == "__main__":
    asyncio.run(main())