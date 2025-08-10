#!/usr/bin/env python3
"""
Improved script to fix forward dependencies in markdown files.
Converts text dependencies to [[filename.md]] format by finding files that define those values.
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
    """Get all files that have unresolved dependencies."""
    files_with_deps = []
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            content = f.read()
        if '_Still_Requires:_' in content and re.search(r'_Still_Requires:_\s*\n\s*-', content):
            files_with_deps.append(filepath)
    return files_with_deps

def extract_dependencies(filepath):
    """Extract dependencies from _Still_Requires:_ section."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    match = re.search(r'_Still_Requires:_\s*\n(.*?)(?:\n\n|_Links:|$)', content, re.DOTALL)
    if match:
        deps_text = match.group(1)
        dependencies = []
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                if dep:  # Skip empty dependencies
                    dependencies.append((line.strip(), dep))
        return dependencies
    return []

def find_matching_files(dependency, definitions_map):
    """Find files that define the given dependency."""
    dep_lower = dependency.lower()
    
    # Direct match
    if dep_lower in definitions_map:
        return definitions_map[dep_lower]
    
    # Try to find partial matches for complex dependencies
    # For example: "average number of newborn children per adult greenland shark in Lunarchasm Ridge"
    # might need to be found as "number of adult greenland shark in Lunarchasm Ridge"
    
    # Extract key components
    location_match = re.search(r' in (.+)$', dep_lower)
    location = location_match.group(1) if location_match else None
    
    # Check if this is asking for average newborn children but we need the adult count
    if 'average number of newborn children per adult' in dep_lower and location:
        # Extract animal type
        animal_match = re.search(r'per adult ([a-z ]+) in', dep_lower)
        if animal_match:
            animal = animal_match.group(1).strip()
            # Look for "number of adult [animal] in [location]"
            adult_count_key = f"number of adult {animal} in {location}"
            if adult_count_key in definitions_map:
                return definitions_map[adult_count_key]
    
    # Check if this is asking for total newborn children
    if 'total number of newborn animal children' in dep_lower and location:
        # This might need multiple files that define newborn children in that location
        matching_files = []
        for key, files in definitions_map.items():
            if location in key and 'average number of newborn children per adult' in key:
                matching_files.extend(files)
        # Also look for adult animal counts in that location
        for key, files in definitions_map.items():
            if location in key and 'number of adult' in key:
                matching_files.extend(files)
        if matching_files:
            return list(set(matching_files))  # Remove duplicates
    
    # Check for number of adult animals
    if 'number of adult' in dep_lower and location:
        # Look for exact match first
        for key, files in definitions_map.items():
            if key == dep_lower:
                return files
        # If no exact match, try without "number of"
        animal_match = re.search(r'number of adult ([a-z ]+) in', dep_lower)
        if animal_match:
            animal = animal_match.group(1).strip()
            for key, files in definitions_map.items():
                if f"adult {animal} in {location}" in key and 'number' in key:
                    return files
    
    return []

def update_file(filepath, dependencies_to_fix):
    """Update the file by moving dependencies from _Still_Requires:_ to _Links: Parent:_"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Remove dependencies from _Still_Requires:_
    for old_line, dep_text, matching_files in dependencies_to_fix:
        content = content.replace(old_line + '\n', '')
    
    # Clean up empty _Still_Requires:_ section
    content = re.sub(r'_Still_Requires:_\s*\n\s*\n', '', content)
    
    # Find or create _Links: Parent: section
    links_match = re.search(r'(_Links:_\s*\nParent:\s*\n)', content)
    
    if links_match:
        # Find insertion point after existing Parent entries
        insert_pos = links_match.end()
        remaining = content[insert_pos:]
        
        # Find end of Parent section
        parent_lines = []
        for line in remaining.split('\n'):
            if line and not line.startswith('-') and not line.startswith(' '):
                break
            parent_lines.append(line)
        
        # Calculate insertion position
        parent_content = '\n'.join(parent_lines[:-1])
        if parent_content:
            insert_pos += len(parent_content) + 1
    else:
        # Add _Links: section at the end
        content = content.rstrip() + '\n\n_Links:_\nParent:\n'
        insert_pos = len(content)
    
    # Add new dependencies
    new_entries = []
    for _, _, matching_files in dependencies_to_fix:
        for match_file in matching_files:
            new_entries.append(f"- has_a_dependency [[{match_file}]]")
    
    if new_entries:
        entries_text = '\n'.join(new_entries) + '\n'
        content = content[:insert_pos] + entries_text + content[insert_pos:]
    
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
    
    print("\nFinding files with unresolved dependencies...")
    files_with_deps = get_files_with_dependencies(directory)
    print(f"Found {len(files_with_deps)} files with dependencies")
    
    total_fixed = 0
    total_skipped = 0
    
    for filepath in files_with_deps:
        filename = os.path.basename(filepath)
        dependencies = extract_dependencies(filepath)
        
        if not dependencies:
            continue
            
        print(f"\nProcessing: {filename}")
        dependencies_to_fix = []
        
        for old_line, dep_text in dependencies:
            matching_files = find_matching_files(dep_text, definitions_map)
            
            if matching_files:
                print(f"  ✓ Found {len(matching_files)} match(es) for: {dep_text}")
                dependencies_to_fix.append((old_line, dep_text, matching_files))
                total_fixed += len(matching_files)
            else:
                print(f"  ✗ No match found for: {dep_text}")
                total_skipped += 1
        
        if dependencies_to_fix:
            if update_file(filepath, dependencies_to_fix):
                print(f"  Updated {filename}")
            else:
                print(f"  Failed to update {filename}")
    
    print(f"\n{'='*60}")
    print(f"Summary: Fixed {total_fixed} dependencies, skipped {total_skipped}")
    
    # Verify results
    remaining = get_files_with_dependencies(directory)
    print(f"Files still with dependencies: {len(remaining)}")

if __name__ == "__main__":
    main()