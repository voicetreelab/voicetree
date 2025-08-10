#!/usr/bin/env python3
"""
Graph traversal script to accumulate content from markdown files following parent links,
and find the most relevant unvisited nodes using TF-IDF.
"""

import os
import re
import sys
import argparse
from pathlib import Path
from typing import Set, List, Dict, Tuple
import nltk
from nltk.corpus import stopwords
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

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

# --- File and Link Operations ---

def read_markdown_file(filepath: Path) -> str:
    """Read content from a markdown file, returning empty string if not found."""
    try:
        return filepath.read_text(encoding='utf-8')
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
        return ""

def extract_markdown_links(content: str) -> List[str]:
    """Extract all markdown links from content, e.g., [[file.md]] or [[file.md|title]]."""
    pattern = r'\[\[([^\]|]+\.md)(?:\|[^\|]+)?\]\]'
    return re.findall(pattern, content)

def extract_parent_links(content: str) -> List[str]:
    """Extract ALL markdown links as parent/dependency links."""
    # Simply use the existing extract_markdown_links function
    return extract_markdown_links(content)

def find_child_references(parent_filename: str, markdown_dir: Path, file_cache: Dict[str, str]) -> List[str]:
    """Find all files that reference the parent file as their parent."""
    children = []
    parent_patterns = [
        r'is_enabled_by\s*\[\[',
        r'is_a_required_capability_for(?:_the)?\s*\[\[',
        r'describes_the_underlying_approach_for(?:_the)?\s*\[\[',
        r'is_a_new_requirement_for(?:_the)?\s*\[\[',
        r'implements_pseudocode_for\s*\[\[',
        r'clarifies_recursion_in\s*\[\['
    ]
    
    # Remove .md extension if present for matching
    parent_name = parent_filename.replace('.md', '')
    
    # Determine the directory of the parent file
    parent_path = markdown_dir / parent_filename
    parent_dir = parent_path.parent
    
    # Only scan markdown files in the same directory as the parent file
    for md_file in parent_dir.glob('*.md'):
        if md_file.name == 'accumulated.md':  # Skip output file
            continue
            
        relative_path = str(md_file.relative_to(markdown_dir))
        
        # Get content from cache or read file
        if relative_path not in file_cache:
            file_cache[relative_path] = read_markdown_file(md_file)
        content = file_cache[relative_path]
        
        # Check if this file has a parent link to our target
        for pattern in parent_patterns:
            # Match patterns like: is_enabled_by [[filename.md]] or [[dir/filename.md]]
            full_pattern = pattern + rf'.*?{re.escape(parent_name)}(?:\.md)?\]\]'
            if re.search(full_pattern, content, re.IGNORECASE):
                children.append(relative_path)
                break
                
    return children

def traverse_children_recursively(
    start_file: str,
    markdown_dir: Path,
    visited: Set[str],
    file_cache: Dict[str, str],
    depth: int = 0,
    max_depth: int = 10
) -> List[Dict[str, str]]:
    """
    Recursively traverse all child nodes (files that reference this file as parent).
    Returns a list of dictionaries with file info and content.
    """
    if start_file in visited or depth > max_depth:
        return []
    
    visited.add(start_file)
    
    filepath = markdown_dir / start_file
    
    if start_file not in file_cache:
        file_cache[start_file] = read_markdown_file(filepath)
        
    content = file_cache[start_file]
    
    if not content:
        return []

    print(f"{' ' * (depth * 2)}Processing child: {start_file}")
    
    # Find all files that reference this file as their parent
    child_files = find_child_references(start_file, markdown_dir, file_cache)
    print(f"{' ' * (depth * 2)}  Found {len(child_files)} children: {child_files}")
    
    result = [{'filename': start_file, 'content': content, 'depth': depth}]
    
    # Recursively traverse each child
    for child_file in child_files:
        child_results = traverse_children_recursively(
            child_file, markdown_dir, visited, file_cache, depth + 1, max_depth
        )
        result.extend(child_results)
            
    return result

def traverse_bidirectional(
    start_file: str,
    markdown_dir: Path,
    visited: Set[str],
    file_cache: Dict[str, str],
    depth: int = 0,
    max_depth: int = 10,
    direction: str = "both"
) -> List[Dict[str, str]]:
    """
    Bidirectionally traverse the graph, following both parent and child links.
    Direction can be: 'both', 'parents', 'children'
    """
    if start_file in visited or depth > max_depth:
        return []
    
    visited.add(start_file)
    
    filepath = markdown_dir / start_file
    
    if start_file not in file_cache:
        file_cache[start_file] = read_markdown_file(filepath)
        
    content = file_cache[start_file]
    
    if not content:
        return []

    print(f"{' ' * (depth * 2)}Processing: {start_file} (direction: {direction})")
    
    result = [{'filename': start_file, 'content': content, 'depth': depth}]
    
    # Traverse to parents
    if direction in ['both', 'parents']:
        parent_links = extract_parent_links(content)
        print(f"{' ' * (depth * 2)}  Found {len(parent_links)} parent links: {parent_links}")
        
        for parent_file in parent_links:
            # First try the link as-is (absolute path from markdown_dir)
            parent_path = markdown_dir / parent_file
            
            # If not found and link doesn't have a directory, try in the same directory as current file
            if not parent_path.exists() and '/' not in parent_file:
                current_file_dir = Path(start_file).parent
                if str(current_file_dir) != '.':
                    # Try in the same directory as the current file
                    parent_file = str(current_file_dir / parent_file)
                    parent_path = markdown_dir / parent_file
            
            if parent_path.exists():
                parent_results = traverse_bidirectional(
                    parent_file, markdown_dir, visited, file_cache, 
                    depth + 1, max_depth, 'parents'  # Only go up when following parents
                )
                result.extend(parent_results)
            else:
                print(f"{' ' * (depth * 2)}  Warning: Parent link not found: {parent_file}")
    
    # Traverse to children
    if direction in ['both', 'children']:
        child_files = find_child_references(start_file, markdown_dir, file_cache)
        print(f"{' ' * (depth * 2)}  Found {len(child_files)} children: {child_files}")
        
        for child_file in child_files:
            child_results = traverse_bidirectional(
                child_file, markdown_dir, visited, file_cache,
                depth + 1, max_depth, 'children'  # Only go down when following children
            )
            result.extend(child_results)
            
    return result

# --- Core Logic: Graph Traversal and TF-IDF ---

def traverse_graph(
    start_file: str,
    markdown_dir: Path,
    visited: Set[str],
    file_cache: Dict[str, str],
    max_depth: int = 10
) -> List[Dict[str, str]]:
    """
    Traverse the graph from a starting file by following both parent and child dependencies.
    Returns a list of dictionaries with file info and content, using a cache.
    """
    return traverse_bidirectional(start_file, markdown_dir, visited, file_cache, depth=0, max_depth=max_depth)

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

def format_traversed_content(branch_content: List[Dict[str, str]], start_file: str, branch_num: int) -> str:
    """Formats the content for a single traversed branch."""
    header = (
        f"\n{'='*20}\n"
        f"BRANCH {branch_num}: Starting from {start_file}\n"
        f"{'='*20}\n"
    )
    
    content_parts = []
    for file_info in reversed(branch_content):
        # Add indentation for child nodes if depth information is available
        depth = file_info.get('depth', 0)
        indent = '  ' * depth if depth > 0 else ''
        file_header = f"\n{'-'*60}\n{indent}File: {file_info['filename']}\n{'-'*60}\n"
        content_parts.append(file_header + file_info['content'])
        
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
            # f"{'-'*60}\n"
        )
        content_parts.append(file_header + content)
        
    return header + "".join(content_parts)

# --- Main Execution ---

def main():
    """Main entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Traverse a graph of markdown files, accumulate content, and find relevant unvisited nodes.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("markdown_dir", type=str, help="The directory containing the markdown files.")
    parser.add_argument("input_files", type=str, nargs='+', help="One or more starting markdown filenames.")
    parser.add_argument("-o", "--output", type=str, default="/tmp/accumulated.md", help="The output file to write the accumulated content to.")
    parser.add_argument("-n", "--num-relevant", type=int, default=3, help="Number of relevant nodes to find.")
    parser.add_argument("-d", "--max-depth", type=int, default=10, help="Maximum traversal depth in each direction (default: 10).")
    
    args = parser.parse_args()
    
    markdown_path = Path(args.markdown_dir)
    if not markdown_path.is_dir():
        print(f"Error: Directory not found: {markdown_path}")
        sys.exit(1)

    all_traversed_info = []
    all_traversed_filenames = set()
    file_cache = {}  # Cache file content to avoid re-reading

    # --- Step 1: Traverse graph for all input files ---
    for i, start_file in enumerate(args.input_files):
        print(f"\n--- Processing branch {i+1}: {start_file} ---")
        # Use a shared visited set if you want to avoid re-processing nodes across branches,
        # or a new set for each branch if they should be treated independently.
        # For this logic, independent sets are better to show full paths for each branch.
        visited_in_branch = set()
        branch_info = traverse_graph(start_file, markdown_path, visited_in_branch, file_cache, args.max_depth)
        
        if branch_info:
            all_traversed_info.append((start_file, branch_info))
            # Make sure we track the filenames exactly as they'll be compared
            for info in branch_info:
                all_traversed_filenames.add(info['filename'])

    # --- Step 2: Find relevant nodes based on ALL traversed content ---
    print("\n--- Performing inverse document search ---")
    aggregated_traversed_content = " ".join(
        info['content'] for _, branch_info in all_traversed_info for info in branch_info
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
    for i, (start_file, branch_info) in enumerate(all_traversed_info):
        final_output.append(format_traversed_content(branch_info, start_file, i + 1))
        
    # Add content from relevant nodes
    final_output.append(format_relevant_nodes(top_relevant_nodes, markdown_path))
    
    output_path = Path(args.output)
    output_path.write_text('\n'.join(final_output), encoding='utf-8')
    
    print(f"\nAccumulated content written to: {output_path}")

if __name__ == "__main__":
    main()
