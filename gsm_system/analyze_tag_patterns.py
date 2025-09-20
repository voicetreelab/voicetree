#!/usr/bin/env python3
"""
Analyze tag patterns to identify duplicates and similar tags that could be consolidated.
"""
import os
import re
import sys
from collections import Counter
from collections import defaultdict
from pathlib import Path


def extract_tags_from_file(file_path):
    """Extract all tags from a markdown file."""
    tags = []
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Find tags in the format #tag or #tag-with-dashes
        tag_pattern = r'#([a-zA-Z0-9_-]+)'
        found_tags = re.findall(tag_pattern, content)
        
        # Add the # back to each tag
        tags = [f'#{tag}' for tag in found_tags]
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}", file=sys.stderr)
    
    return tags


def analyze_tag_patterns(folder_path):
    """Analyze tag patterns and identify potential duplicates."""
    folder = Path(folder_path)
    
    if not folder.exists() or not folder.is_dir():
        print(f"Error: Invalid folder path '{folder_path}'")
        return
    
    all_tags = []
    markdown_files = list(folder.rglob('*.md'))
    
    print(f"Analyzing {len(markdown_files)} markdown files...")
    
    # Extract tags from each file
    for md_file in markdown_files:
        tags = extract_tags_from_file(md_file)
        all_tags.extend(tags)
    
    # Count tag occurrences
    tag_counter = Counter(all_tags)
    
    # Group tags by patterns
    animal_tags = defaultdict(list)
    location_tags = defaultdict(list)
    concept_tags = []
    
    # Categorize tags
    for tag, count in tag_counter.items():
        tag_lower = tag.lower()
        
        # Check if it's an animal tag
        if 'adult_' in tag_lower or 'newborn_' in tag_lower:
            # Extract the animal name
            if 'adult_' in tag_lower:
                animal = tag_lower.replace('#adult_', '').replace('_', ' ')
                animal_tags['adult'].append((tag, count, animal))
            elif 'newborn_' in tag_lower:
                animal = tag_lower.replace('#newborn_', '').replace('_', ' ')
                animal_tags['newborn'].append((tag, count, animal))
        
        # Check if it's a location tag
        elif any(loc in tag_lower for loc in ['_ranch', '_zoo', '_farm', '_aquarium', '_circus', 
                                               '_caverns', '_hollow', '_grotto', '_chasms', '_depths',
                                               '_catacombs', '_rift', '_vault', '_ocean', '_basin',
                                               '_shoals', '_waters', '_maze', '_chamber', '_tunnels']):
            location_tags['locations'].append((tag, count))
        
        # Everything else is a concept tag
        else:
            concept_tags.append((tag, count))
    
    # Print analysis
    print(f"\n{'='*60}")
    print("TAG PATTERN ANALYSIS")
    print(f"{'='*60}")
    
    print(f"\nTotal unique tags: {len(tag_counter)}")
    print(f"Total tag occurrences: {len(all_tags)}")
    
    # Adult animal tags
    print(f"\n{'ADULT ANIMAL TAGS':^60}")
    print(f"{'-'*60}")
    adult_animals = animal_tags['adult']
    print(f"Total unique adult animal tags: {len(adult_animals)}")
    print("\nTop 10 by frequency:")
    for tag, count, animal in sorted(adult_animals, key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {tag:<40} {count:>5} occurrences")
    
    # Find potential duplicates (singular/plural, underscores vs no underscores)
    print("\nPotential duplicate patterns in adult animals:")
    seen_animals = {}
    for tag, count, animal in adult_animals:
        base_animal = animal.rstrip('s')  # Remove potential plural
        if base_animal in seen_animals:
            print(f"  - {tag} ({count}) might duplicate {seen_animals[base_animal][0]} ({seen_animals[base_animal][1]})")
        else:
            seen_animals[base_animal] = (tag, count)
    
    # Newborn animal tags
    print(f"\n{'NEWBORN ANIMAL TAGS':^60}")
    print(f"{'-'*60}")
    newborn_animals = animal_tags['newborn']
    print(f"Total unique newborn animal tags: {len(newborn_animals)}")
    for tag, count, animal in sorted(newborn_animals, key=lambda x: x[1], reverse=True):
        print(f"  {tag:<40} {count:>5} occurrences")
    
    # Location tags
    print(f"\n{'LOCATION TAGS':^60}")
    print(f"{'-'*60}")
    locations = location_tags['locations']
    print(f"Total unique location tags: {len(locations)}")
    for tag, count in sorted(locations, key=lambda x: x[1], reverse=True):
        print(f"  {tag:<40} {count:>5} occurrences")
    
    # Concept tags
    print(f"\n{'CONCEPT/CALCULATION TAGS':^60}")
    print(f"{'-'*60}")
    print(f"Total unique concept tags: {len(concept_tags)}")
    for tag, count in sorted(concept_tags, key=lambda x: x[1], reverse=True)[:20]:
        print(f"  {tag:<40} {count:>5} occurrences")
    
    # Summary recommendations
    print(f"\n{'CONSOLIDATION OPPORTUNITIES':^60}")
    print(f"{'-'*60}")
    print(f"1. Adult animal tags: {len(adult_animals)} unique tags")
    print(f"   - Could consolidate to just #adult tag")
    print(f"   - Or keep top 5-10 most common species")
    
    print(f"\n2. Location tags: {len(locations)} unique tags") 
    print(f"   - Currently have {len(locations)} unique locations")
    print(f"   - Could consolidate to general location types")
    
    print(f"\n3. Concept tags: {len(concept_tags)} unique tags")
    print(f"   - Core calculation tags are well-used")
    print(f"   - Many low-frequency variants could be removed")
    
    # Files per tag analysis
    print(f"\n{'FILES PER TAG ANALYSIS':^60}")
    print(f"{'-'*60}")
    
    # Re-analyze to see how many files each tag appears in
    tag_file_count = defaultdict(set)
    for md_file in markdown_files:
        tags = extract_tags_from_file(md_file)
        for tag in tags:
            tag_file_count[tag].add(str(md_file))
    
    # Show tags that appear in only 1-2 files (candidates for removal)
    single_file_tags = []
    few_file_tags = []
    
    for tag, files in tag_file_count.items():
        if len(files) == 1:
            single_file_tags.append(tag)
        elif len(files) <= 3:
            few_file_tags.append(tag)
    
    print(f"Tags appearing in only 1 file: {len(single_file_tags)}")
    print(f"Tags appearing in 2-3 files: {len(few_file_tags)}")
    print(f"\nRemoving single-file tags would reduce from {len(tag_counter)} to {len(tag_counter) - len(single_file_tags)} tags")


def main():
    if len(sys.argv) != 2:
        print("Usage: python analyze_tag_patterns.py <folder_path>")
        sys.exit(1)
    
    folder_path = sys.argv[1]
    analyze_tag_patterns(folder_path)


if __name__ == "__main__":
    main()