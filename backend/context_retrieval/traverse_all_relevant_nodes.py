"""
Integration script that combines vector search with dependency traversal.
Uses vector_search.py to find relevant nodes based on a query,
then traverses their dependencies to build comprehensive context.

This is the implementation of the integration script actions defined in node 11.
It accepts a query and tree as input, uses vector search to find relevant nodes,
and traverses those nodes with their relationships.
"""

import sys
import logging
from pathlib import Path
from typing import List, Dict, Tuple, Optional

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from backend.context_retrieval.dependency_traversal import traverse_to_node, TraversalOptions, accumulate_content
from backend.context_retrieval.content_filtering import ContentLevel
from backend.context_retrieval.vector_search import find_relevant_nodes_for_context

def traverse_all_relevant_nodes(query: str, tree: Dict, markdown_dir: Optional[Path] = None, top_k: int = 10, embeddings_path: Optional[Path] = None):
    """
    Traverse relevant nodes found via vector search based on query and tree.
    
    Args:
        query: Search query for finding relevant nodes
        tree: Dictionary of node_id -> Node objects
        markdown_dir: Path to markdown directory (optional, will be inferred from tree)
        top_k: Number of relevant nodes to retrieve (default: 10)
        embeddings_path: Optional path to pre-generated embeddings (backend/embeddings_output)
    """
    
    # Use vector search to find relevant nodes dynamically
    print(f"🔍 Searching for relevant nodes for query: '{query}'")
    
    # Pass embeddings path if available
    node_ids = find_relevant_nodes_for_context(tree, query, top_k=top_k, embeddings_path=embeddings_path)
    
    # Convert node IDs to filenames with similarity scores
    relevant_nodes = []
    for i, node_id in enumerate(node_ids):
        # Find the node in the tree to get its filename
        if node_id in tree:
            node = tree[node_id]
            if hasattr(node, 'filename'):
                # Use index-based scoring as we don't have actual scores from the simplified API
                similarity = 1.0 - (i * 0.05)  # Decreasing scores
                relevant_nodes.append((node.filename, similarity))
                
                # Infer markdown_dir from first node if not provided
                if markdown_dir is None and hasattr(node, 'filepath'):
                    node_path = Path(node.filepath)
                    markdown_dir = node_path.parent
    
    if not relevant_nodes:
        print("⚠️ No relevant nodes found via vector search")
        return {}
    
    # Ensure we have a markdown directory
    if markdown_dir is None:
        print("⚠️ Could not determine markdown directory from tree")
        return {}
    
    # Collect all traversed nodes with their content
    all_traversed_nodes = []
    
    for node_file, similarity in relevant_nodes:
        # Get full content and immediate connections
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=20,  # Deeper traversal to see full dependency chains
            include_neighborhood=True,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        nodes = traverse_to_node(node_file, markdown_dir, options)
        
        # Add metadata about which file was the search target
        for node in nodes:
            node['is_search_target'] = (node.get('filename') == node_file)
            node['search_similarity'] = similarity
        
        all_traversed_nodes.extend(nodes)
    
    print(f"Search complete. Found and traversed {len(all_traversed_nodes)} total nodes.")
    
    return all_traversed_nodes

def main():
    """
    Main function demonstrating search-based traversal.
    Loads tree from markdown directory and performs vector search.
    """
    # Import the tree loader from the correct location
    from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_tree
    
    # Example query
    query = "If the original audio has low clarity, after completing the audio cutting, what should I do?"
    
    # Load tree from markdown directory
    markdown_dir = Path("/Users/bobbobby/repos/VoiceTree/backend/benchmarker/output/user_guide_qa_audio_processing_connected_final")
    
    # Path to pre-generated embeddings
    embeddings_path = Path("/Users/bobbobby/repos/VoiceTree/backend/embeddings_output")
    
    print(f"Loading tree from: {markdown_dir}")
    print(f"Using embeddings from: {embeddings_path}")
    
    try:
        # Load the tree using the existing function
        tree = load_markdown_tree(str(markdown_dir))
        print(f"Successfully loaded {len(tree)} nodes from markdown files")
        
        # Map node IDs to actual filenames by checking the markdown directory
        import os
        md_files = {f: f for f in os.listdir(markdown_dir) if f.endswith('.md')}
        
        # Also ensure each node has its filename attribute
        for node_id, node in tree.items():
            # Look for the actual file that starts with the node_id
            for filename in md_files:
                if filename.startswith(f"{node_id}_"):
                    node.filename = filename
                    break
            else:
                # Fallback if no matching file found
                if hasattr(node, 'file_name') and node.file_name:
                    node.filename = node.file_name
                else:
                    logging.warning(f"Could not find filename for node {node_id}")
        
        print(f"\nQuery: {query}")
        print("\nPerforming vector search and traversal...")
        
        # Run the traversal with vector search, using pre-generated embeddings
        results = traverse_all_relevant_nodes(query, tree, markdown_dir, embeddings_path=embeddings_path)
        
        print(f"\nTraversal complete. Found content for {len(results)} nodes.")
        
        # Convert the results to text using accumulate_content
        if results:
            print("\n" + "="*80)
            print("ACCUMULATED CONTEXT")
            print("="*80 + "\n")
            
            accumulated_text = accumulate_content(results, include_metadata=True)
            print(accumulated_text)
            
            # Optionally save to file
            output_file = Path("context_output.txt")
            with open(output_file, 'w') as f:
                f.write(f"Query: {query}\n")
                f.write(f"Total nodes: {len(results)}\n")
                f.write("="*80 + "\n\n")
                f.write(accumulated_text)
            print(f"\n\nContext also saved to: {output_file}")
        
    except Exception as e:
        print(f"Error loading tree or performing traversal: {e}")
        import traceback
        traceback.print_exc()
    
if __name__ == "__main__":
    main()