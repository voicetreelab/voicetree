#!/usr/bin/env python3
"""
Final script to fix all dependencies in markdown files:
1. Converts text dependencies to [[filename.md]] format
2. Moves [[filename.md]] links from _Requires:_ to _Links:_ with "requires" prefix
3. Removes empty _Requires:_ and _Still_Requires:_ sections
"""

import os
import re
import glob
from collections import defaultdict

def get_all_definitions(directory):
    """Build a map of all definitions to their files."""
    definitions_map = defaultdict(list)
    
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            content = f.read()
        
        # Extract definitions from _Defines:_ section
        defines_match = re.search(r'_Defines:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
        if defines_match:
            defines_text = defines_match.group(1)
            for line in defines_text.split('\n'):
                if line.strip().startswith('- '):
                    definition = line.strip()[2:].strip()
                    filename = os.path.basename(filepath)
                    definitions_map[definition.lower()].append(filename)
    
    return definitions_map

def get_files_with_dependencies(directory):
    """Get all files that have any dependencies (_Requires:_ or _Still_Requires:_)."""
    files_with_deps = []
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            content = f.read()
        if ('_Requires:_' in content or '_Still_Requires:_' in content):
            files_with_deps.append(filepath)
    return files_with_deps

def extract_all_dependencies(filepath):
    """Extract dependencies from both _Requires:_ and _Still_Requires:_ sections."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    dependencies = []
    
    # Extract from _Requires:_ section
    requires_match = re.search(r'_Requires:_\s*\n(.*?)(?:\n\n|_Still_Requires:|_Links:|$)', content, re.DOTALL)
    if requires_match:
        deps_text = requires_match.group(1)
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                # Check if it's already a markdown link
                if dep.startswith('[[') and dep.endswith(']]'):
                    # Already linked - extract filename
                    dependencies.append(('_Requires:_', line.strip(), dep, dep[2:-2], True))
                else:
                    # Extract just the dependency text (remove parenthetical notes)
                    dep_clean = re.sub(r'\s*\(from.*?\)\s*$', '', dep).strip()
                    if dep_clean:
                        dependencies.append(('_Requires:_', line.strip(), dep_clean, None, False))
    
    # Extract from _Still_Requires:_ section
    still_requires_match = re.search(r'_Still_Requires:_\s*\n(.*?)(?:\n\n|_Links:|$)', content, re.DOTALL)
    if still_requires_match:
        deps_text = still_requires_match.group(1)
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                if not (dep.startswith('[[') and dep.endswith(']]')):
                    if dep:
                        dependencies.append(('_Still_Requires:_', line.strip(), dep, None, False))
    
    return dependencies

def find_matching_files(dependency, definitions_map):
    """Find files that define the given dependency."""
    dep_lower = dependency.lower()
    
    # Direct match
    if dep_lower in definitions_map:
        return definitions_map[dep_lower]
    
    # Handle special cases
    location_match = re.search(r' in (.+)$', dep_lower)
    location = location_match.group(1) if location_match else None
    
    # Case 1: average newborn children per adult X in Y -> need number of adult X in Y
    if 'average number of newborn children per adult' in dep_lower and location:
        animal_match = re.search(r'per adult ([a-z ]+) in', dep_lower)
        if animal_match:
            animal = animal_match.group(1).strip()
            adult_count_key = f"number of adult {animal} in {location}"
            if adult_count_key in definitions_map:
                return definitions_map[adult_count_key]
    
    # Case 2: total number of newborn animal children in X
    if 'total number of newborn animal children' in dep_lower and location:
        # Look for any definitions related to that location
        matching_files = []
        for key, files in definitions_map.items():
            if location in key and ('newborn' in key or 'adult' in key):
                matching_files.extend(files)
        if matching_files:
            return list(set(matching_files))[:5]  # Limit to 5 matches
    
    # Case 3: Try partial matching for complex dependencies
    words = dep_lower.split()
    if len(words) > 3:
        # Try to find files that contain most of the important words
        matches = []
        for key, files in definitions_map.items():
            score = sum(1 for word in words if len(word) > 3 and word in key)
            if score >= len(words) * 0.5:  # At least 50% word match
                matches.append((score, files))
        if matches:
            # Return files from the best match
            matches.sort(key=lambda x: x[0], reverse=True)
            return matches[0][1]
    
    return []

def update_file(filepath, dependencies_to_process):
    """Update the file by moving dependencies to _Links:_ section."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Collect all dependencies to add to _Links:_
    links_to_add = []
    
    # Process each dependency
    for section, old_line, dep_text, filename, is_linked in dependencies_to_process:
        # Remove the dependency from its current location
        content = content.replace(old_line + '\n', '')
        
        # Collect the links to add
        if is_linked:
            # Already a markdown link - just use the filename
            links_to_add.append(f"- requires [[{filename}]]")
        else:
            # Text dependency - use matched files
            matching_files = find_matching_files(dep_text, dependencies_to_process[-1])  # Pass definitions_map
            for match_file in matching_files[:1]:  # Use only first match
                links_to_add.append(f"- requires [[{match_file}]]")
    
    # Clean up empty sections
    content = re.sub(r'_Still_Requires:_\s*\n\s*\n', '', content)
    content = re.sub(r'_Requires:_\s*\n\s*\n', '', content)
    
    # Find or create _Links:_ section and add dependencies
    if links_to_add:
        links_match = re.search(r'(-+\s*\n_Links:_\s*\n)', content)
        
        if links_match:
            # Find insertion point after _Links:_
            insert_pos = links_match.end()
            
            # Add new links
            new_links = '\n'.join(links_to_add) + '\n'
            content = content[:insert_pos] + '\n' + new_links + content[insert_pos:]
        else:
            # No _Links:_ section found, create one
            # Find the separator line
            separator_match = re.search(r'(\n-+\s*\n)', content)
            if separator_match:
                insert_pos = separator_match.end()
                new_section = '_Links:_\n\n' + '\n'.join(links_to_add) + '\n'
                content = content[:insert_pos] + new_section + content[insert_pos:]
            else:
                # No separator found, add at end
                content = content.rstrip() + '\n\n-----------------\n_Links:_\n\n' + '\n'.join(links_to_add) + '\n'
    
    # Write back if changed
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    directory = 'backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question'
    
    print(f"Building definitions map for {directory}...")
    definitions_map = get_all_definitions(directory)
    print(f"Found {len(definitions_map)} unique definitions")
    
    print("\nFinding files with dependencies...")
    files_with_deps = get_files_with_dependencies(directory)
    print(f"Found {len(files_with_deps)} files with dependencies")
    
    total_moved = 0
    total_converted = 0
    
    for filepath in files_with_deps:
        filename = os.path.basename(filepath)
        dependencies = extract_all_dependencies(filepath)
        
        if not dependencies:
            continue
            
        print(f"\nProcessing: {filename}")
        dependencies_to_process = []
        
        for dep_info in dependencies:
            if len(dep_info) == 5:  # New format with is_linked flag
                section, old_line, dep_text, filename_or_none, is_linked = dep_info
                
                if is_linked:
                    print(f"  Moving linked dependency: {filename_or_none}")
                    dependencies_to_process.append(dep_info)
                    total_moved += 1
                else:
                    # Text dependency - find matching files
                    matching_files = find_matching_files(dep_text, definitions_map)
                    if matching_files:
                        print(f"  Converting and moving: {dep_text} -> {matching_files[0]}")
                        # Add definitions_map as last element for update_file
                        dependencies_to_process.append(dep_info)
                        total_converted += 1
        
        if dependencies_to_process:
            # Add definitions_map to the list for update_file
            dependencies_to_process.append(definitions_map)
            if update_file(filepath, dependencies_to_process):
                print(f"  ✓ Updated {filename}")
            else:
                print(f"  ✗ Failed to update {filename}")
    
    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"  Moved {total_moved} markdown links to _Links:_ section")
    print(f"  Converted and moved {total_converted} text dependencies")
    print(f"  Total dependencies processed: {total_moved + total_converted}")

if __name__ == "__main__":
    main()