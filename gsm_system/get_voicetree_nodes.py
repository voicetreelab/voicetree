#!/usr/bin/env python3
"""
Simple tool to retrieve VoiceTree nodes for question answering.
Returns node titles and summaries from a VoiceTree output directory.
"""

import os
import sys
import json
from pathlib import Path


def get_voicetree_nodes(output_dir):
    """
    Retrieve all nodes from a VoiceTree output directory.
    
    Args:
        output_dir: Path to the VoiceTree output directory
        
    Returns:
        List of dictionaries containing node information
    """
    nodes = []
    output_path = Path(output_dir)
    
    if not output_path.exists():
        return {"error": f"Directory {output_dir} does not exist"}
    
    # Find all markdown files (nodes) in the directory
    for md_file in output_path.glob("*.md"):
        if md_file.name.startswith("_"):  # Skip any private/system files
            continue
            
        node_info = {
            "filename": md_file.name,
            "title": "",
            "summary": "",
        }
        
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                
                # Parse YAML frontmatter and content
                in_frontmatter = False
                frontmatter_lines = []
                content_lines = []
                
                for i, line in enumerate(lines):
                    if line.strip() == '---':
                        if not in_frontmatter and i == 0:
                            in_frontmatter = True
                        elif in_frontmatter:
                            in_frontmatter = False
                            continue
                    elif in_frontmatter:
                        frontmatter_lines.append(line)
                    else:
                        content_lines.append(line)
                
                # Extract title from frontmatter
                for line in frontmatter_lines:
                    if line.startswith('title:'):
                        node_info['title'] = line.replace('title:', '').strip()
                        break
                
                # Get summary (first heading line after frontmatter)
                for line in content_lines:
                    if line.startswith('###'):
                        node_info['summary'] = line.replace('###', '').strip()
                        break
                
                nodes.append(node_info)
                
        except Exception as e:
            print(f"Error reading {md_file}: {e}", file=sys.stderr)
    
    # Sort nodes by filename (which typically includes node ID)
    nodes.sort(key=lambda x: x['filename'])
    
    return nodes


def main():
    """Main function for command-line usage."""
    if len(sys.argv) != 2:
        print("Usage: python get_voicetree_nodes.py <voicetree_output_dir>")
        print("Example: python get_voicetree_nodes.py backend/benchmarker/output/nolima_twohop_spain")
        sys.exit(1)
    
    output_dir = sys.argv[1]
    nodes = get_voicetree_nodes(output_dir)
    
    if isinstance(nodes, dict) and "error" in nodes:
        print(f"Error: {nodes['error']}", file=sys.stderr)
        sys.exit(1)
    
    # Print nodes in a simple, readable format
    print(f"Found {len(nodes)} nodes in {output_dir}:\n")
    
    for i, node in enumerate(nodes, 1):
        print(f"Node {i}: {node['filename']}")
        if node['summary']:
            print(f"  Summary: {node['summary']}")
        print()
    
    # Also output JSON for programmatic use
    print("\n--- JSON OUTPUT ---")
    print(json.dumps(nodes, indent=2))


if __name__ == "__main__":
    main()