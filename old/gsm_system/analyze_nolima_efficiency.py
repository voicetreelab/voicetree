#!/usr/bin/env python3
"""
Analyze the efficiency of VoiceTree for NoLiMa question answering.
Calculates context reduction by comparing nodes needed vs full text.
"""

import os
import sys
from pathlib import Path

from get_voicetree_nodes import get_voicetree_nodes


def count_words(text):
    """Count words in a text string."""
    return len(text.split())


def analyze_efficiency(output_dir, original_text_file, required_node_ids):
    """
    Analyze how efficient VoiceTree was at reducing context for answering.
    
    Args:
        output_dir: Path to VoiceTree output directory
        original_text_file: Path to original input text
        required_node_ids: List of node IDs actually needed to answer
        
    Returns:
        Dictionary with efficiency metrics
    """
    # Get all nodes
    nodes = get_voicetree_nodes(output_dir)
    
    # Read original text
    with open(original_text_file, 'r') as f:
        original_text = f.read()
    
    # Calculate original metrics
    original_words = count_words(original_text)
    original_chars = len(original_text)
    
    # Calculate node metrics
    total_node_words = 0
    total_node_chars = 0
    required_node_words = 0
    required_node_chars = 0
    
    for node in nodes:
        node_text = node['full_content']
        node_words = count_words(node_text)
        node_chars = len(node_text)
        
        total_node_words += node_words
        total_node_chars += node_chars
        
        # Check if this node is required for answering
        # Extract node ID from filename (e.g., "4_Megan_Views_Garden.md" -> 4)
        try:
            node_id = int(node['filename'].split('_')[0])
            if node_id in required_node_ids:
                required_node_words += node_words
                required_node_chars += node_chars
                print(f"Required node {node_id}: {node['title']} ({node_words} words)")
        except:
            pass
    
    # Calculate efficiency metrics
    metrics = {
        "original_words": original_words,
        "original_chars": original_chars,
        "total_nodes": len(nodes),
        "total_node_words": total_node_words,
        "total_node_chars": total_node_chars,
        "required_nodes": len(required_node_ids),
        "required_node_words": required_node_words,
        "required_node_chars": required_node_chars,
        
        # Reduction percentages
        "nodes_needed_pct": (len(required_node_ids) / len(nodes)) * 100 if nodes else 0,
        "words_needed_pct": (required_node_words / original_words) * 100 if original_words else 0,
        "chars_needed_pct": (required_node_chars / original_chars) * 100 if original_chars else 0,
        
        # Context reduction
        "word_reduction_pct": 100 - ((required_node_words / original_words) * 100) if original_words else 0,
        "char_reduction_pct": 100 - ((required_node_chars / original_chars) * 100) if original_chars else 0,
        
        # Graph overhead (how much extra text the graph structure adds)
        "graph_overhead_pct": ((total_node_words - original_words) / original_words) * 100 if original_words else 0
    }
    
    return metrics


def main():
    """Main function for NoLiMa Spain question analysis."""
    
    # Paths
    output_dir = "backend/benchmarker/output/nolima_twohop_spain"
    original_text = "backend/benchmarker/input/nolima_twohop_spain.txt"
    
    # For the Spain question, we only need node 4 (Megan and the painting)
    required_nodes = [4]  # Node 4: Megan Views 'Garden of Earthly Delights'
    
    print("=" * 70)
    print("NoLiMa VoiceTree Efficiency Analysis")
    print("Question: Which character has been to Spain?")
    print("=" * 70)
    
    metrics = analyze_efficiency(output_dir, original_text, required_nodes)
    
    print(f"\n📊 ORIGINAL CONTEXT:")
    print(f"  Words: {metrics['original_words']:,}")
    print(f"  Characters: {metrics['original_chars']:,}")
    
    print(f"\n🌳 VOICETREE GRAPH:")
    print(f"  Total nodes created: {metrics['total_nodes']}")
    print(f"  Total words in all nodes: {metrics['total_node_words']:,}")
    print(f"  Graph overhead: {metrics['graph_overhead_pct']:.1f}% extra text")
    
    print(f"\n✅ NODES NEEDED TO ANSWER:")
    print(f"  Required nodes: {metrics['required_nodes']} out of {metrics['total_nodes']} ({metrics['nodes_needed_pct']:.1f}%)")
    print(f"  Required words: {metrics['required_node_words']} out of {metrics['original_words']} original")
    
    print(f"\n🎯 EFFICIENCY METRICS:")
    print(f"  Context reduction: {metrics['word_reduction_pct']:.1f}% fewer words needed")
    print(f"  Character reduction: {metrics['char_reduction_pct']:.1f}% fewer characters")
    print(f"  Node efficiency: Only {metrics['nodes_needed_pct']:.1f}% of nodes needed")
    
    print(f"\n💡 INSIGHT:")
    if metrics['word_reduction_pct'] > 90:
        print(f"  Excellent! VoiceTree reduced context by >{metrics['word_reduction_pct']:.0f}%")
        print(f"  Only {metrics['required_node_words']} words needed vs {metrics['original_words']} original")
    elif metrics['word_reduction_pct'] > 70:
        print(f"  Good! VoiceTree reduced context by {metrics['word_reduction_pct']:.1f}%")
    else:
        print(f"  Moderate reduction of {metrics['word_reduction_pct']:.1f}%")
    
    # Compare to NoLiMa context lengths
    print(f"\n📏 NOLIMA CONTEXT COMPARISON:")
    print(f"  Our test: {metrics['original_words']} words (shortened version)")
    print(f"  NoLiMa 1K: ~1,000 tokens (~750 words)")
    print(f"  NoLiMa 32K: ~32,000 tokens (~24,000 words)")
    print(f"  NoLiMa 128K: ~128,000 tokens (~96,000 words)")
    
    # Project efficiency to larger contexts
    if metrics['word_reduction_pct'] > 0:
        print(f"\n🔮 PROJECTED FOR FULL NOLIMA:")
        for context_name, word_count in [("1K", 750), ("32K", 24000), ("128K", 96000)]:
            projected_words = int(word_count * (metrics['required_node_words'] / metrics['original_words']))
            print(f"  {context_name} context: ~{projected_words} words needed ({metrics['word_reduction_pct']:.1f}% reduction)")


if __name__ == "__main__":
    main()