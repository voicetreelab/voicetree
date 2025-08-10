#!/usr/bin/env python3
"""
Enhanced script to fix all forward dependencies in markdown files.
Converts both _Requires:_ and _Still_Requires:_ text dependencies to [[filename.md]] format.
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
                if not (dep.startswith('[[') and dep.endswith(']]')):
                    # Extract just the dependency text (remove parenthetical notes)
                    dep_clean = re.sub(r'\s*\(from.*?\)\s*$', '', dep).strip()
                    if dep_clean:
                        dependencies.append(('_Requires:_', line.strip(), dep_clean))
    
    # Extract from _Still_Requires:_ section
    still_requires_match = re.search(r'_Still_Requires:_\s*\n(.*?)(?:\n\n|_Links:|$)', content, re.DOTALL)
    if still_requires_match:
        deps_text = still_requires_match.group(1)
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                if not (dep.startswith('[[') and dep.endswith(']]')):
                    if dep:
                        dependencies.append(('_Still_Requires:_', line.strip(), dep))
    
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

def update_file(filepath, dependencies_to_fix):
    """Update the file by converting text dependencies to markdown links."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Process each dependency
    for section, old_line, dep_text, matching_files in dependencies_to_fix:
        if section == '_Still_Requires:_':
            # Remove from _Still_Requires:_ and add to _Links: Parent:_
            content = content.replace(old_line + '\n', '')
            
            # Add to _Links: Parent:_ section
            links_match = re.search(r'(_Links:_\s*\nParent:\s*\n)', content)
            if links_match:
                insert_pos = links_match.end()
                remaining = content[insert_pos:]
                
                # Find end of Parent section
                parent_lines = []
                for line in remaining.split('\n'):
                    if line and not line.startswith('-') and not line.startswith(' '):
                        break
                    parent_lines.append(line)
                
                parent_content = '\n'.join(parent_lines[:-1])
                if parent_content:
                    insert_pos += len(parent_content) + 1
            else:
                # Add _Links: section at the end
                content = content.rstrip() + '\n\n_Links:_\nParent:\n'
                insert_pos = len(content)
            
            # Add new dependencies
            new_entries = []
            for match_file in matching_files:
                new_entries.append(f"- has_a_dependency [[{match_file}]]")
            
            if new_entries:
                entries_text = '\n'.join(new_entries) + '\n'
                content = content[:insert_pos] + entries_text + content[insert_pos:]
                
        else:  # _Requires:_ section
            # Replace text dependency with markdown link in place
            for match_file in matching_files[:1]:  # Use only first match for _Requires:_
                new_line = f"- [[{match_file}]]"
                content = content.replace(old_line, new_line)
    
    # Clean up empty sections
    content = re.sub(r'_Still_Requires:_\s*\n\s*\n', '', content)
    content = re.sub(r'_Requires:_\s*\n\s*\n', '', content)
    
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
    
    total_fixed = 0
    total_skipped = 0
    
    for filepath in files_with_deps:
        filename = os.path.basename(filepath)
        dependencies = extract_all_dependencies(filepath)
        
        if not dependencies:
            continue
            
        print(f"\nProcessing: {filename}")
        dependencies_to_fix = []
        
        for section, old_line, dep_text in dependencies:
            matching_files = find_matching_files(dep_text, definitions_map)
            
            if matching_files:
                print(f"  ✓ Found {len(matching_files)} match(es) for: {dep_text}")
                dependencies_to_fix.append((section, old_line, dep_text, matching_files))
                total_fixed += 1
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
    text_deps_count = 0
    for filepath in remaining:
        deps = extract_all_dependencies(filepath)
        text_deps_count += len(deps)
    
    print(f"Files still with dependencies: {len(remaining)}")
    print(f"Text dependencies remaining: {text_deps_count}")

if __name__ == "__main__":
    main()