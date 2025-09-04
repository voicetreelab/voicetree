"""
Script to traverse ALL top 5 relevant nodes and compile comprehensive answer.
"""

import sys
from pathlib import Path
from typing import List, Dict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from backend.context_retrieval.dependency_traversal import traverse_to_node, TraversalOptions
from backend.context_retrieval.content_filtering import ContentLevel

def traverse_all_relevant_nodes():
    """
    Traverse ALL top 5 relevant nodes from our query:
    "If the original audio has low clarity, after completing the audio cutting, what should I do?"
    """
    
    # Path to the markdown files
    markdown_dir = Path("/Users/bobbobby/repos/VoiceTree/backend/benchmarker/output/user_guide_qa_audio_processing_connected_final")
    
    # ALL relevant nodes with their similarity scores
    relevant_nodes = [
        ("112_Troubleshooting_Dense_Audio_Cutting.md", 0.6507),
        ("107_Audio_Cutting_and_Preparation.md", 0.6438),
        ("109_Specific_Audio_Cutting_Process.md", 0.6224),
        ("111_Post-Cutting_Manual_Audio_Adjustment.md", 0.5844),
        ("114_Perform_Audio_Noise_Reduction_Steps.md", 0.5622)
    ]
    
    all_node_content = {}
    
    print("=" * 80)
    print("COMPREHENSIVE TRAVERSAL OF TOP 5 RELEVANT NODES")
    print("=" * 80)
    
    for node_file, similarity in relevant_nodes:
        print(f"\n{'='*60}")
        # print(f"📍 Node: {node_file}")
        print(f"   Similarity Score: {similarity:.4f}")
        print(f"{'='*60}\n")
        
        # Get full content and immediate connections
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=7,  # Deeper traversal to see full dependency chains
            include_neighborhood=True,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        nodes = traverse_to_node(node_file, markdown_dir, options)
        
        # Group nodes by depth for better visualization
        nodes_by_depth = {}
        for node in nodes:
            depth = node.get('depth', 0)
            if depth not in nodes_by_depth:
                nodes_by_depth[depth] = []
            nodes_by_depth[depth].append(node)
        
        # Print the full traversal
        print(f"Traversed {len(nodes)} nodes:")
        
        # Print from highest depth (root parents) to lowest (children)
        for depth in sorted(nodes_by_depth.keys(), reverse=True):
            if depth > 0:
                print(f"\n  Parent Level {depth}:")
            elif depth == 0:
                print(f"\n  Target Node:")
            else:
                print(f"\n  Child Level {abs(depth)}:")
            
            for node in nodes_by_depth[depth]:
                filename = node.get('filename', 'Unknown')
                title = node.get('title', 'Unknown')
                node_id = node.get('node_id', 'N/A')
                
                # Special formatting for target node
                if filename == node_file:
                    all_node_content[node_file] = node
                    print(f"    >>> {title}")
                    # print(f"        File: {filename}")
                    print(f"        Summary: {node.get('summary', 'N/A')}")
                    
                    # Extract key content for target node
                    content = node.get('content', '')
                    print(f"        Key Content:")
                    lines = content.split('\n')
                    for line in lines:
                        if line.strip() and not line.startswith('---') and not line.startswith('node_id:') and not line.startswith('title:') and not line.startswith('###') and not line.startswith('_Links'):
                            if 'should' in line.lower() or 'must' in line.lower() or 'need' in line.lower() or 'step' in line.lower() or 'dB' in line or 'min_' in line or 'max_' in line:
                                print(f"          • {line.strip()}")
                else:
                    print(f"    - {title}")
                    # print(f"      File: {filename}")
        
        print()
    
    return all_node_content

if __name__ == "__main__":
    traverse_all_relevant_nodes()