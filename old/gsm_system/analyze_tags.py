#!/usr/bin/env python3
"""
Analyze tags in markdown files and output them sorted by frequency.
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path


def extract_tags_from_file(file_path):
    """Extract all tags from a markdown file."""
    tags = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Find tags in the format #tag or #tag-with-dashes
        # Tags must start with # and be followed by word characters or hyphens
        tag_pattern = r'#([a-zA-Z0-9_-]+)'
        found_tags = re.findall(tag_pattern, content)
        
        # Add the # back to each tag
        tags = [f'#{tag}' for tag in found_tags]
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}", file=sys.stderr)
    
    return tags


def analyze_tags_in_folder(folder_path):
    """Analyze all tags in markdown files within a folder."""
    folder = Path(folder_path)
    
    if not folder.exists():
        print(f"Error: Folder '{folder_path}' does not exist")
        return
    
    if not folder.is_dir():
        print(f"Error: '{folder_path}' is not a directory")
        return
    
    all_tags = []
    
    # Find all markdown files
    markdown_files = list(folder.rglob('*.md'))
    
    if not markdown_files:
        print(f"No markdown files found in '{folder_path}'")
        return
    
    print(f"Analyzing {len(markdown_files)} markdown files...")
    
    # Extract tags from each file
    for md_file in markdown_files:
        tags = extract_tags_from_file(md_file)
        all_tags.extend(tags)
    
    if not all_tags:
        print("No tags found in any markdown files")
        return
    
    # Count tag occurrences
    tag_counter = Counter(all_tags)
    
    # Sort by frequency (descending) and then alphabetically
    sorted_tags = sorted(tag_counter.items(), key=lambda x: (-x[1], x[0]))
    
    # Display results
    print(f"\nTotal unique tags: {len(tag_counter)}")
    print(f"Total tag occurrences: {len(all_tags)}")
    print("\nTags by frequency:")
    print("-" * 40)
    
    for tag, count in sorted_tags:
        print(f"{tag:<20} {count:>5} occurrences")


def main():
    if len(sys.argv) != 2:
        print("Usage: python analyze_tags.py <folder_path>")
        print("Example: python analyze_tags.py backend/tests/animal_example_clustered")
        sys.exit(1)
    
    folder_path = sys.argv[1]
    analyze_tags_in_folder(folder_path)


if __name__ == "__main__":
    main()