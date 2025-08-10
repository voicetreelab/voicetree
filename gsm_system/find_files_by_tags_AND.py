#!/usr/bin/env python3
"""
Find markdown files that contain ALL of the specified tags.
"""
import os
import re
from pathlib import Path
import sys
from typing import List, Set


def extract_tags_from_file(file_path: Path) -> Set[str]:
    """Extract all tags from a markdown file."""
    tags = set()
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Find tags in the format #tag or #tag-with-dashes
        tag_pattern = r'#([a-zA-Z0-9_-]+)'
        found_tags = re.findall(tag_pattern, content)
        
        # Add the # back to each tag
        tags = {f'#{tag}' for tag in found_tags}
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}", file=sys.stderr)
    
    return tags


def find_files_with_tags(folder_path: str, target_tags: List[str]) -> List[Path]:
    """Find all markdown files that contain ALL of the target tags."""
    folder = Path(folder_path)
    
    if not folder.exists() or not folder.is_dir():
        print(f"Error: Invalid folder path '{folder_path}'")
        return []
    
    # Normalize target tags to include # if not present
    normalized_tags = set()
    for tag in target_tags:
        if not tag.startswith('#'):
            normalized_tags.add(f'#{tag}')
        else:
            normalized_tags.add(tag)
    
    matching_files = []
    markdown_files = list(folder.rglob('*.md'))
    
    print(f"Searching {len(markdown_files)} markdown files for ALL tags: {normalized_tags}")
    
    # Check each file for matching tags
    for md_file in markdown_files:
        file_tags = extract_tags_from_file(md_file)
        
        # Check if ALL target tags are in the file's tags
        if normalized_tags.issubset(file_tags):  # All target tags must be in file_tags
            matching_files.append(md_file)
    
    return matching_files


def main():
    if len(sys.argv) < 3:
        print("Usage: python find_files_by_tags_AND.py <folder_path> <tag1> [tag2] [tag3] ...")
        print("Example: python find_files_by_tags_AND.py ./backend/tests/animal_example_clustered adult_crow adult_parrot")
        print("\nNote: Tags can be provided with or without the # prefix")
        sys.exit(1)
    
    folder_path = sys.argv[1]
    target_tags = sys.argv[2:]
    
    matching_files = find_files_with_tags(folder_path, target_tags)
    
    if matching_files:
        print(f"\nFound {len(matching_files)} files with ALL of the specified tags:")
        print("-" * 80)
        
        # Group files by matched tags for better readability
        file_tags_map = {}
        normalized_tags = {tag if tag.startswith('#') else f'#{tag}' for tag in target_tags}
        
        for file in sorted(matching_files):
            file_tags = extract_tags_from_file(file)
            matched_tags = file_tags & normalized_tags
            file_tags_map[file] = matched_tags
        
        for file, matched_tags in sorted(file_tags_map.items()):
            # Show relative path from the search folder
            relative_path = file.relative_to(Path(folder_path).parent)
            print(f"  {relative_path}")
            print(f"    Matched tags: {', '.join(sorted(matched_tags))}")
            print()
    else:
        print("\nNo files found with the specified tags.")


if __name__ == "__main__":
    main()