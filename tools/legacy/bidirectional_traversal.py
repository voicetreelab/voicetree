#!/usr/bin/env python3
"""
Bidirectional graph traversal with weighted DFS.
Accumulates content from nodes within a weighted distance threshold.

Distance costs:
- Outgoing edges (children/links): 1.5
- Incoming edges (parents/backlinks): 1.0
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

# Import from our refactored modules
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.markdown_tree_manager.markdown_to_tree.file_operations import (
    read_markdown_file,
)


# --- Graph Building ---

def extract_wikilinks(content: str) -> List[str]:
    """Extract all wikilink targets from markdown content."""
    # Match [[target]] or [[target|alias]]
    pattern = r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]'
    matches = re.findall(pattern, content)
    # Normalize to .md extension if not present
    return [
        match if match.endswith('.md') else f"{match}.md"
        for match in matches
    ]


def resolve_link_path(link: str, source_file: Path, markdown_dir: Path) -> str:
    """
    Resolve a wikilink to its actual relative path from markdown_dir.

    Tries in order:
    1. Link as-is (absolute from markdown_dir)
    2. Relative to source file's directory
    """
    # Try link as-is first
    if (markdown_dir / link).exists():
        return link

    # Try relative to source file's directory
    source_dir = source_file.parent
    relative_candidate = source_dir / link
    if (markdown_dir / relative_candidate).exists():
        return str(relative_candidate)

    # If neither exists, try looking for the file basename in the same directory
    link_basename = Path(link).name
    relative_candidate = source_dir / link_basename
    if (markdown_dir / relative_candidate).exists():
        return str(relative_candidate)

    # Return original link even if not found (will be handled later)
    return link


def build_graph(markdown_dir: Path) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    """
    Build graph structure from markdown files.

    Returns:
        Tuple of (outgoing_edges, incoming_edges) where:
        - outgoing_edges: {filename: [list of linked files]}
        - incoming_edges: {filename: [list of files that link to this]}
    """
    outgoing_edges: Dict[str, List[str]] = {}
    incoming_edges: Dict[str, List[str]] = {}

    # Find all markdown files
    all_md_files = [p for p in markdown_dir.glob('**/*.md') if p.is_file()]

    # Build mapping of relative paths
    for md_file in all_md_files:
        relative_path = str(md_file.relative_to(markdown_dir))

        # Initialize empty edge lists
        outgoing_edges[relative_path] = []
        if relative_path not in incoming_edges:
            incoming_edges[relative_path] = []

        # Parse content for wikilinks
        try:
            content = read_markdown_file(md_file)
            links = extract_wikilinks(content)

            for link in links:
                # Resolve link relative to source file's location
                link_path = resolve_link_path(link, Path(relative_path), markdown_dir)

                # Add to outgoing edges
                outgoing_edges[relative_path].append(link_path)

                # Add to incoming edges (backlinks)
                if link_path not in incoming_edges:
                    incoming_edges[link_path] = []
                incoming_edges[link_path].append(relative_path)

        except Exception as e:
            print(f"Warning: Could not parse {relative_path}: {e}", file=sys.stderr)

    return outgoing_edges, incoming_edges


# --- Weighted DFS Traversal ---

def dfs_visit(
    node_id: str,
    distance: float,
    visited: Dict[str, float],
    outgoing_edges: Dict[str, List[str]],
    incoming_edges: Dict[str, List[str]],
    max_distance: float
) -> None:
    """
    Recursive DFS with weighted edges.

    Updates visited dict in-place with minimum distance for each node.
    """
    # Base case: stop if already visited with shorter or equal distance
    if node_id in visited and visited[node_id] <= distance:
        return

    # Mark as visited with current distance
    visited[node_id] = distance

    # Explore outgoing edges (children) - cost 1.5
    if node_id in outgoing_edges:
        for child in outgoing_edges[node_id]:
            new_distance = distance + 1.5
            if new_distance < max_distance:
                dfs_visit(child, new_distance, visited, outgoing_edges, incoming_edges, max_distance)

    # Explore incoming edges (parents) - cost 1.0
    if node_id in incoming_edges:
        for parent in incoming_edges[node_id]:
            new_distance = distance + 1.0
            if new_distance < max_distance:
                dfs_visit(parent, new_distance, visited, outgoing_edges, incoming_edges, max_distance)


def weighted_dfs_traversal(
    start_files: List[str],
    markdown_dir: Path,
    max_distance: float
) -> Dict[str, Dict[str, any]]:
    """
    Performs weighted DFS from start_files, accumulating all nodes within max_distance.

    Args:
        start_files: List of starting markdown filenames (relative paths)
        markdown_dir: Path to markdown directory
        max_distance: Maximum weighted distance threshold

    Returns:
        dict: {filename: {'content': str, 'distance': float}}
    """
    print(f"Building graph from {markdown_dir}...")
    outgoing_edges, incoming_edges = build_graph(markdown_dir)

    print(f"Found {len(outgoing_edges)} nodes in graph")

    # Track visited nodes with their minimum distance
    visited_nodes: Dict[str, float] = {}

    # Run DFS from each starting file
    for start_file in start_files:
        print(f"Running DFS from {start_file}...")

        # Normalize start_file to relative path
        if not start_file.endswith('.md'):
            start_file = f"{start_file}.md"

        dfs_visit(start_file, 0.0, visited_nodes, outgoing_edges, incoming_edges, max_distance)

    print(f"Found {len(visited_nodes)} nodes within distance {max_distance}")

    # Load content for all visited nodes
    result = {}
    for filename, distance in visited_nodes.items():
        file_path = markdown_dir / filename
        if file_path.exists():
            try:
                content = read_markdown_file(file_path)
                result[filename] = {
                    'content': content,
                    'distance': distance
                }
            except Exception as e:
                print(f"Warning: Could not read {filename}: {e}", file=sys.stderr)
        else:
            print(f"Warning: File not found: {filename}", file=sys.stderr)

    return result


# --- Output Formatting ---

def format_output(traversal_result: Dict[str, Dict], start_files: List[str]) -> str:
    """
    Format accumulated content as markdown.

    Returns string with:
    - Header with starting files
    - Nodes sorted by distance (closest first)
    - Each node's content with filename separator
    """
    output = []
    output.append(f"# Context from: {', '.join(start_files)}\n")
    output.append(f"Total nodes: {len(traversal_result)}\n")

    # Sort by distance (closest first), then by filename for stability
    sorted_nodes = sorted(
        traversal_result.items(),
        key=lambda x: (x[1]['distance'], x[0])
    )

    for filename, data in sorted_nodes:
        output.append(f"\n{'='*80}")
        output.append(f"File: {filename} (distance: {data['distance']:.1f})")
        output.append(f"{'='*80}\n")
        output.append(data['content'])

    return '\n'.join(output)


# --- Main ---

def main():
    """Main entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Bidirectional weighted DFS traversal of markdown graph.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "markdown_dir",
        type=str,
        help="The directory containing the markdown files."
    )
    parser.add_argument(
        "input_files",
        type=str,
        nargs='+',
        help="One or more starting markdown filenames (relative paths or basenames)."
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="/tmp/context.md",
        help="The output file to write the accumulated content to (default: /tmp/context.md)."
    )
    parser.add_argument(
        "-d", "--max-distance",
        type=float,
        default=5.0,
        help="Maximum weighted distance threshold (default: 5.0)."
    )

    args = parser.parse_args()

    markdown_path = Path(args.markdown_dir)
    if not markdown_path.is_dir():
        print(f"Error: Directory not found: {markdown_path}", file=sys.stderr)
        sys.exit(1)

    # Run weighted DFS traversal
    result = weighted_dfs_traversal(
        args.input_files,
        markdown_path,
        args.max_distance
    )

    if not result:
        print("Warning: No nodes found in traversal", file=sys.stderr)
        sys.exit(1)

    # Format output
    output_content = format_output(result, args.input_files)

    # Write to file
    output_path = Path(args.output)
    output_path.write_text(output_content, encoding='utf-8')

    print(f"\nAccumulated content written to: {output_path}")
    print(f"Total nodes: {len(result)}")


if __name__ == "__main__":
    main()
