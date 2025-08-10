#!/usr/bin/env python3
"""
Tool to retrieve full content of specific VoiceTree nodes.
Usage: python get_full_contents.py <dir> <node1> <node2> ...
Where nodes can be either filenames (with or without .md) or node titles.
"""

import os
import sys
import json
from pathlib import Path


def get_full_content(output_dir, node_identifiers):
    """
    Retrieve full content of specific nodes from a VoiceTree output directory.
    
    Args:
        output_dir: Path to the VoiceTree output directory
        node_identifiers: List of node identifiers (filenames or titles)
        
    Returns:
        Dictionary mapping identifiers to their full content
    """
    results = {}
    output_path = Path(output_dir)
    
    if not output_path.exists():
        return {"error": f"Directory {output_dir} does not exist"}
    
    # Build a mapping of titles to files for quick lookup
    title_to_file = {}
    for md_file in output_path.glob("*.md"):
        if md_file.name.startswith("_"):
            continue
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = content.split('\n')
                
                # Parse title from frontmatter
                in_frontmatter = False
                for i, line in enumerate(lines):
                    if line.strip() == '---':
                        if i == 0:
                            in_frontmatter = True
                        elif in_frontmatter:
                            break
                    elif in_frontmatter and line.startswith('title:'):
                        title = line.replace('title:', '').strip()
                        title_to_file[title.lower()] = md_file
                        break
        except Exception as e:
            print(f"Error scanning {md_file}: {e}", file=sys.stderr)
    
    # Process each requested node
    for identifier in node_identifiers:
        found = False
        content = None
        
        # Try as filename first
        if identifier.endswith('.md'):
            file_path = output_path / identifier
        else:
            file_path = output_path / f"{identifier}.md"
        
        if file_path.exists():
            found = True
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    full_text = f.read()
                    # Remove frontmatter for cleaner output
                    lines = full_text.split('\n')
                    content_lines = []
                    in_frontmatter = False
                    frontmatter_ended = False
                    
                    for i, line in enumerate(lines):
                        if line.strip() == '---':
                            if i == 0:
                                in_frontmatter = True
                            elif in_frontmatter:
                                in_frontmatter = False
                                frontmatter_ended = True
                                continue
                        elif not in_frontmatter or frontmatter_ended:
                            content_lines.append(line)
                    
                    content = '\n'.join(content_lines).strip()
            except Exception as e:
                content = f"Error reading file: {e}"
        
        # If not found as filename, try as title
        if not found:
            lower_identifier = identifier.lower()
            for title, file_path in title_to_file.items():
                if lower_identifier in title or title in lower_identifier:
                    found = True
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            full_text = f.read()
                            # Remove frontmatter
                            lines = full_text.split('\n')
                            content_lines = []
                            in_frontmatter = False
                            frontmatter_ended = False
                            
                            for i, line in enumerate(lines):
                                if line.strip() == '---':
                                    if i == 0:
                                        in_frontmatter = True
                                    elif in_frontmatter:
                                        in_frontmatter = False
                                        frontmatter_ended = True
                                        continue
                                elif not in_frontmatter or frontmatter_ended:
                                    content_lines.append(line)
                            
                            content = '\n'.join(content_lines).strip()
                    except Exception as e:
                        content = f"Error reading file: {e}"
                    break
        
        if found:
            results[identifier] = content
        else:
            results[identifier] = f"Node not found: {identifier}"
    
    return results


def main():
    """Main function for command-line usage."""
    if len(sys.argv) < 3:
        print("Usage: python get_full_contents.py <voicetree_output_dir> <node1> [<node2> ...]")
        print("Example: python get_full_contents.py backend/benchmarker/output/nolima_8k_spain node_1 node_2.md \"Character Introduction\"")
        sys.exit(1)
    
    output_dir = sys.argv[1]
    node_identifiers = sys.argv[2:]
    
    contents = get_full_content(output_dir, node_identifiers)
    
    if isinstance(contents, dict) and "error" in contents:
        print(f"Error: {contents['error']}", file=sys.stderr)
        sys.exit(1)
    
    # Print results in a readable format
    for identifier, content in contents.items():
        print(f"=== Content for: {identifier} ===")
        print(content)
        print("\n" + "="*50 + "\n")
    
    # Also output JSON for programmatic use
    print("\n--- JSON OUTPUT ---")
    print(json.dumps(contents, indent=2))


if __name__ == "__main__":
    main()