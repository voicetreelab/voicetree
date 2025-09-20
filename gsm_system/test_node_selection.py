#!/usr/bin/env python3
"""
Test case for node selection algorithm to reproduce the issue where Node 51 was not selected.
"""

import sys
import os
from pathlib import Path

# Add the current directory to the Python path
sys.path.insert(0, os.path.dirname(__file__))

from backend.markdown_tree_manager.markdown_to_tree import load_markdown_tree
from backend.markdown_tree_manager.graph_search.tree_functions import get_most_relevant_nodes
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree

def main():
    # Load the markdown tree
    markdown_dir = Path("backend/benchmarker/output_backups/igsm_op17_ip20_force_True_0_problem_question_backup_20250730_132335")
    
    print("Loading markdown tree...")
    tree_dict = load_markdown_tree(markdown_dir)
    
    # Create a DecisionTree object
    tree = MarkdownTree()
    tree.tree = tree_dict
    
    print(f"Loaded tree with {len(tree.tree)} nodes")
    
    # The query that was used in the actual scenario
    query = """The average number of newborn children per adult parrot in Mayer Aquarium equals the sum of the average number of newborn children per adult blue jay in Mayer Aquarium, the average number of newborn children per adult crow in South Zoo, and the number of adult parrot in Jefferson Circus."""
    
    # Get the most relevant nodes with typical limit (let's use 100)
    limit = 30
    print(f"\nRunning get_most_relevant_nodes with limit={limit}")
    selected_nodes = get_most_relevant_nodes(tree, limit=limit, query=query)
    
    print(f"\nSelected {len(selected_nodes)} nodes")
    
    # Check if Node 51 was selected
    node_51_selected = any(node.id == 51 for node in selected_nodes)
    print(f"\nNode 51 selected: {node_51_selected}")
    
    # Find Node 51 in the full tree
    if 51 in tree.tree:
        node_51 = tree.tree[51]
        print(f"\nNode 51 details:")
        print(f"  Title: {node_51.title}")
        print(f"  Summary: {node_51.summary}")
        print(f"  Modified at: {node_51.modified_at}")
        print(f"  Is root: {node_51.parent_id is None}")
    
    # Show what nodes WERE selected
    print("\nSelected nodes (showing first 20):")
    for i, node in enumerate(selected_nodes[:20]):
        print(f"  {node.id}: {node.title}")
    
    # Analyze selection breakdown
    root_count = sum(1 for node in selected_nodes if node.parent_id is None)
    print(f"\nSelection breakdown:")
    print(f"  Root nodes: {root_count}")
    
    # Sort selected nodes by modified_at to see how many were recent
    selected_by_recency = sorted(selected_nodes, key=lambda x: x.modified_at, reverse=True)
    
    # Find the cutoff time for "recent" nodes
    if len(selected_nodes) > 0:
        cutoff_idx = min((5 * limit) // 8, len(selected_nodes))
        if cutoff_idx > 0:
            recent_cutoff_time = selected_by_recency[cutoff_idx - 1].modified_at
            print(f"  Recent nodes cutoff time: {recent_cutoff_time}")
            
            if 51 in tree.tree:
                print(f"  Node 51 modified at: {tree.tree[51].modified_at}")
                print(f"  Node 51 is recent: {tree.tree[51].modified_at >= recent_cutoff_time}")
    
    # Show which nodes contain the key terms from the query
    print("\nNodes containing key terms:")
    key_terms = ["blue jay", "Mayer Aquarium", "Jefferson Circus", "parrot"]
    
    for term in key_terms:
        matching_nodes = [
            node for node in selected_nodes 
            if term.lower() in node.title.lower() or term.lower() in node.summary.lower()
        ]
        print(f"  '{term}': {len(matching_nodes)} nodes")
        for node in matching_nodes[:5]:  # Show first 5
            print(f"    - Node {node.id}: {node.title}")

    # Analyze dependency-aware search
    print("\n\n=== DEPENDENCY-AWARE SEARCH ANALYSIS ===")
    
    # Extract needed parameters from the query
    from backend.markdown_tree_manager.graph_search.tree_functions import _extract_needed_parameters, _extract_defined_parameter
    
    needed_params = _extract_needed_parameters(query)
    print(f"\nQuery needs these parameters: {needed_params}")
    
    # Check which nodes define these parameters
    print("\nNodes that define needed parameters:")
    for node in selected_nodes[:10]:
        # Use content if available
        if hasattr(node, 'content') and node.content:
            node_text = node.content
        else:
            node_text = f"{node.title} {node.summary}"
        defined_param = _extract_defined_parameter(node_text)
        if defined_param:
            print(f"  - Node {node.id} defines: {defined_param}")
            if defined_param in needed_params:
                print(f"    ✓ MATCHES a needed parameter!")
    
    # Analyze why top nodes scored higher than Node 51
    print("\n\n=== DETAILED TF-IDF ANALYSIS ===")
    
    # Get the nodes we want to compare
    nodes_to_analyze = [5, 25, 27, 51]
    
    print(f"\nQuery (deduplicated): {' '.join(dict.fromkeys(query.lower().split()))}")
    print(f"\nAnalyzing why these nodes ranked higher than Node 51:")
    
    for node_id in nodes_to_analyze:
        if node_id in tree.tree:
            node = tree.tree[node_id]
            print(f"\n--- Node {node_id} ---")
            print(f"Title: {node.title}")
            print(f"Summary: {node.summary}")
            
            # Extract key terms from query and check their presence
            print("\nKey term matches:")
            terms = {
                "parrot": 0,
                "mayer aquarium": 0,
                "blue jay": 0,
                "jefferson circus": 0,
                "crow": 0,
                "south zoo": 0,
                "newborn children": 0,
                "average": 0,
                "adult": 0
            }
            
            # Check title and summary for term matches
            node_text = f"{node.title} {node.summary}".lower()
            
            for term in terms:
                if term in node_text:
                    terms[term] = node_text.count(term)
            
            # Print matches
            for term, count in terms.items():
                if count > 0:
                    print(f"  - '{term}': {count} times")
            
            # Count total bigram/trigram matches
            print("\nPhrase matches (bigrams/trigrams):")
            phrases = [
                "mayer aquarium",
                "jefferson circus", 
                "south zoo",
                "blue jay",
                "newborn children",
                "adult parrot",
                "adult blue jay",
                "adult crow",
                "average number"
            ]
            
            phrase_matches = 0
            for phrase in phrases:
                if phrase in node_text:
                    count = node_text.count(phrase)
                    if count > 0:
                        print(f"  - '{phrase}': {count} times")
                        phrase_matches += count
            
            print(f"\nTotal phrase matches: {phrase_matches}")

if __name__ == "__main__":
    main()