#!/usr/bin/env python3
"""
Graph traversal script - thin wrapper around the refactored modules.
Provides command-line interface for dependency traversal and TF-IDF search.
"""

import sys
import argparse
from pathlib import Path
from typing import Set, List, Dict
import nltk
from nltk.corpus import stopwords
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import re

# Import from our refactored modules
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.markdown_tree_manager.markdown_to_tree.file_operations import read_markdown_file
from backend.context_retrieval.dependency_traversal import traverse_to_node, TraversalOptions
from backend.context_retrieval.content_filtering import ContentLevel

# --- Setup and Text Preprocessing ---

def setup_nltk_stopwords():
    """Ensure NLTK stopwords are downloaded."""
    try:
        nltk.data.find('corpora/stopwords')
    except nltk.downloader.DownloadError:
        print("Downloading NLTK stopwords...")
        nltk.download('stopwords', quiet=True)

setup_nltk_stopwords()
STOP_WORDS = set(stopwords.words('english'))

def preprocess_text(text: str) -> str:
    """Cleans and tokenizes text for TF-IDF."""
    text = text.lower()
    text = re.sub(r'[^a-z\s]', '', text)  # Remove punctuation and numbers
    tokens = text.split()
    tokens = [word for word in tokens if word not in STOP_WORDS]
    return ' '.join(tokens)

# --- TF-IDF Search ---

def find_top_relevant_nodes(
    traversed_content: str,
    traversed_filenames: Set[str],
    markdown_dir: Path,
    num_results: int = 3
) -> List[Dict[str, float]]:
    """
    Finds top N relevant nodes using TF-IDF against the aggregated traversed content.
    """
    all_md_files = [p for p in markdown_dir.glob('**/*.md') if p.is_file()]
    # Compare using relative paths to ensure consistency
    candidate_files = []
    for f in all_md_files:
        relative_path = str(f.relative_to(markdown_dir))
        # Exclude traversed files and the output file itself
        if relative_path not in traversed_filenames and f.name != 'accumulated.md':
            candidate_files.append(f)
    
    if not candidate_files:
        print("No candidate files for inverse document search.")
        return []

    corpus_contents = [read_markdown_file(f) for f in candidate_files]
    
    if not any(corpus_contents):
        print("No content in candidate files for inverse search.")
        return []

    vectorizer = TfidfVectorizer(preprocessor=preprocess_text)
    tfidf_matrix = vectorizer.fit_transform(corpus_contents)
    
    # Transform the single aggregated document of traversed content
    traversed_vec = vectorizer.transform([traversed_content])
    
    # Calculate similarity
    cosine_similarities = cosine_similarity(traversed_vec, tfidf_matrix).flatten()
    
    # Get top N similar files
    most_similar_indices = cosine_similarities.argsort()[-num_results:][::-1]
    
    relevant_nodes = []
    for idx in most_similar_indices:
        similarity = cosine_similarities[idx]
        if similarity > 0:  # Only include nodes with some similarity
            # Store the relative path from markdown_dir, not just the filename
            relative_path = candidate_files[idx].relative_to(markdown_dir)
            relevant_nodes.append({
                'filename': str(relative_path),
                'similarity': float(similarity)
            })
            
    return relevant_nodes

# --- Output Generation ---

def format_traversed_content(nodes: List[Dict], start_file: str, branch_num: int) -> str:
    """Formats the content for a single traversed branch."""
    header = (
        f"\n{'='*20}\n"
        f"BRANCH {branch_num}: Starting from {start_file}\n"
        f"{'='*20}\n"
    )
    
    content_parts = []
    # Sort nodes by depth (root first) if depth information is available
    sorted_nodes = sorted(nodes, key=lambda x: x.get('depth', 0), reverse=True)
    
    for node in sorted_nodes:
        # Add indentation for child nodes if depth information is available
        depth = node.get('depth', 0)
        indent = '  ' * depth if depth > 0 else ''
        
        # Get content from node
        content = node.get('content', '')
        if not content and 'filename' in node:
            # If content not in node, try to load it
            content = f"[Content not loaded for {node['filename']}]"
        
        file_header = f"\n{'-'*60}\n{indent}File: {node.get('filename', 'Unknown')}\n{'-'*60}\n"
        content_parts.append(file_header + content)
        
    return header + "".join(content_parts)

def format_relevant_nodes(relevant_nodes: List[Dict], markdown_dir: Path) -> str:
    """Formats the content for the most relevant nodes found."""
    if not relevant_nodes:
        return ""
        
    header = (
        f"\n{'='*20}\n"
        "RELEVANT NODES (Found via TF-IDF Inverse Document Search)\n"
        f"{'='*20}\n"
    )
    
    content_parts = []
    for node in relevant_nodes:
        content = read_markdown_file(markdown_dir / node['filename'])
        file_header = (
            f"\n{'-'*20}\n"
            f"File: {node['filename']} (Similarity: {node['similarity']:.4f})\n"
        )
        content_parts.append(file_header + content)
        
    return header + "".join(content_parts)

# --- Main Execution ---

def main():
    """Main entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Traverse a graph of markdown files using the refactored modules.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("markdown_dir", type=str, help="The directory containing the markdown files.")
    parser.add_argument("input_files", type=str, nargs='+', help="One or more starting markdown filenames.")
    parser.add_argument("-o", "--output", type=str, default="/tmp/accumulated.md", help="The output file to write the accumulated content to.")
    parser.add_argument("-n", "--num-relevant", type=int, default=3, help="Number of relevant nodes to find via TF-IDF.")
    parser.add_argument("-d", "--max-depth", type=int, default=10, help="Maximum traversal depth in each direction (default: 10).")
    
    args = parser.parse_args()
    
    markdown_path = Path(args.markdown_dir)
    if not markdown_path.is_dir():
        print(f"Error: Directory not found: {markdown_path}")
        sys.exit(1)

    all_traversed_info = []
    all_traversed_filenames = set()

    # --- Step 1: Use new modules for traversal ---
    for i, start_file in enumerate(args.input_files):
        print(f"\n--- Processing branch {i+1}: {start_file} ---")
        
        # Use the new traverse_to_node function with options
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=args.max_depth,
            include_neighborhood=False,  # Keep it simple for now
            content_level=ContentLevel.FULL_CONTENT  # Get full content for TF-IDF
        )
        
        print(f"Using new context_retrieval module for traversal...")
        nodes = traverse_to_node(start_file, markdown_path, options)
        
        if nodes:
            all_traversed_info.append((start_file, nodes))
            # Track filenames for exclusion in TF-IDF search
            for node in nodes:
                if 'filename' in node:
                    all_traversed_filenames.add(node['filename'])
        
        print(f"  Found {len(nodes)} nodes in traversal")

    # --- Step 2: Find relevant nodes based on ALL traversed content ---
    print("\n--- Performing inverse document search ---")
    aggregated_traversed_content = " ".join(
        node.get('content') or '' for _, nodes in all_traversed_info for node in nodes
    )
    
    top_relevant_nodes = find_top_relevant_nodes(
        aggregated_traversed_content,
        all_traversed_filenames,
        markdown_path,
        args.num_relevant
    )

    if top_relevant_nodes:
        print(f"Top {args.num_relevant} most relevant nodes (excluding traversed):")
        for node in top_relevant_nodes:
            print(f"- {node['filename']} (Similarity: {node['similarity']:.4f})")
    else:
        print("No additional relevant nodes found.")

    # --- Step 3: Generate and write the output file ---
    final_output = []
    # Add content from traversed branches
    for i, (start_file, nodes) in enumerate(all_traversed_info):
        final_output.append(format_traversed_content(nodes, start_file, i + 1))
        
    # Add content from relevant nodes
    final_output.append(format_relevant_nodes(top_relevant_nodes, markdown_path))
    
    output_path = Path(args.output)
    output_path.write_text('\n'.join(final_output), encoding='utf-8')
    
    print(f"\nAccumulated content written to: {output_path}")

if __name__ == "__main__":
    main()