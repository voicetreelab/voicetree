#!/usr/bin/env python3
"""
Graph traversal script to accumulate content from markdown files following parent links.
"""

import os
import re
import sys
from pathlib import Path
from typing import Set, List, Dict


def extract_all_markdown_links(content: str) -> List[str]:
    """Extract all markdown links from content, handling both [[file.md]] and [[file.md|title]] formats."""
    # Match [[filename.md]] or [[filename.md|title]]
    pattern = r'\[\[([^\]|]+\.md)(?:\|[^\]]+)?\]\]'
    matches = re.findall(pattern, content)
    return matches


def read_markdown_file(filepath: Path) -> str:
    """Read content from a markdown file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
        return ""


def traverse_graph(start_file: str, markdown_dir: Path, visited: Set[str]) -> List[Dict[str, str]]:
    """
    Traverse the graph starting from a file, following all markdown links.
    Returns a list of dictionaries containing file info and content.
    """
    if start_file in visited:
        return []
    
    visited.add(start_file)
    
    filepath = markdown_dir / start_file
    content = read_markdown_file(filepath)
    
    if not content:
        return []
    
    # Extract all markdown links
    linked_files = extract_all_markdown_links(content)
    
    # Current node info
    result = [{
        'filename': start_file,
        'content': content
    }]
    
    # Traverse all linked files
    for linked_file in linked_files:
        linked_result = traverse_graph(linked_file, markdown_dir, visited)
        result.extend(linked_result)
    
    return result


def accumulate_content(input_files: List[str], markdown_dir: str, output_file: str = "accumulated.md"):
    """
    Main function to accumulate content from multiple input files.
    """
    markdown_path = Path(markdown_dir)
    
    if not markdown_path.exists():
        print(f"Error: Directory {markdown_dir} does not exist")
        return
    
    accumulated_content = []
    
    for idx, input_file in enumerate(input_files):
        # Reset visited set for each starting file to track separate branches
        visited = set()
        
        print(f"Processing branch {idx + 1}: {input_file}")
        
        # Traverse from this starting point
        branch_content = traverse_graph(input_file, markdown_path, visited)
        
        if branch_content:
            # Add branch header
            accumulated_content.append(f"\n{'='*80}")
            accumulated_content.append(f"BRANCH {idx + 1}: Starting from {input_file}")
            accumulated_content.append(f"{'='*80}\n")
            
            # Add content from each file in the branch (in reverse order to show root -> leaf)
            for file_info in reversed(branch_content):
                accumulated_content.append(f"\n{'-'*60}")
                accumulated_content.append(f"File: {file_info['filename']}")
                accumulated_content.append(f"{'-'*60}\n")
                accumulated_content.append(file_info['content'])
    
    # Write accumulated content to output file
    output_path = Path(output_file)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(accumulated_content))
    
    print(f"\nAccumulated content written to: {output_path}")


def main():
    """Main entry point."""
    if len(sys.argv) < 3:
        print("Usage: python graph_dependency_traversal_and_accumulate_graph_content.py <markdown_dir> <file1.md> [file2.md] ...")
        print("Example: python graph_dependency_traversal_and_accumulate_graph_content.py backend/tests/animal_example_clustered 603_Total_number_of_newborn_animal_children_in_Shardlight_Chasms.md backend/tests/animal_example_clustered 600_Average_number_of_newborn_animal_children_in_Shardlight_Chasms.m")
        sys.exit(1)
    
    markdown_dir = sys.argv[1]
    input_files = sys.argv[2:]
    
    accumulate_content(input_files, markdown_dir)


if __name__ == "__main__":
    main()