#!/usr/bin/env python3
"""
Simple script to fix dependencies by finding files that define the required values.
"""

import os
import re
import glob

def get_unresolved_dependencies(directory):
    """Get all files with _Still_Requires:_ dependencies."""
    files_with_deps = []
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            if '_Still_Requires:_' in f.read():
                files_with_deps.append(filepath)
    return files_with_deps

def extract_dependencies(filepath):
    """Extract all dependencies from a file."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Find _Still_Requires:_ section
    match = re.search(r'_Still_Requires:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
    if match:
        deps_text = match.group(1)
        deps = []
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                deps.append((line.strip(), dep))
        return deps
    return []

def find_file_that_defines(dependency_text, directory):
    """Find a file that defines the given dependency."""
    # Normalize the dependency text
    dep_normalized = dependency_text.strip().lower()
    
    # Special case mappings for known variations
    special_mappings = {
        'number of adult crows in jefferson circus': 'number of adult crow in jefferson circus',
        'number of adult eagles in bundle ranch': 'number of adult eagle in bundle ranch',
        'number of adult eagles in mayer aquarium': 'number of adult eagle in mayer aquarium',
        'average newborn children per adult clownfish in starlight summit': 'average number of newborn children per adult clownfish in starlight summit',
        'formula for number of adult jackal in heavenspire peak': 'number of adult jackal in heavenspire peak'
    }
    
    # Apply special case mapping if exists
    if dep_normalized in special_mappings:
        dep_normalized = special_mappings[dep_normalized]
    
    # First, try exact match in _Defines:_ section
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            content = f.read()
            
        # Look for _Defines:_ section
        defines_match = re.search(r'_Defines:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
        if defines_match:
            defines_text = defines_match.group(1)
            for line in defines_text.split('\n'):
                if line.strip().startswith('- '):
                    defined_value = line.strip()[2:].strip().lower()
                    if defined_value == dep_normalized:
                        # Found a match!
                        filename = os.path.basename(filepath)
                        return filename
    
    # If no exact match found, check special cases like "total number of adult animals"
    if 'total number of adult animals' in dep_normalized:
        # Look for files whose title matches the pattern
        for filepath in glob.glob(os.path.join(directory, "*.md")):
            filename = os.path.basename(filepath)
            with open(filepath, 'r') as f:
                content = f.read()
                # Check the title line
                title_match = re.search(r'title:\s*(.+)', content)
                if title_match:
                    title = title_match.group(1).lower()
                    if 'total number of adult animals' in title and 'jefferson circus' in dep_normalized and 'jefferson circus' in title:
                        return filename
                    elif 'total number of adult animals' in title and 'south zoo' in dep_normalized and 'south zoo' in title:
                        return filename
    
    # Check for "total number of newborn animal children" patterns - these need multiple links
    if 'total number of newborn animal children' in dep_normalized:
        location = None
        if 'cloudveil plateau' in dep_normalized:
            location = 'cloudveil plateau'
        elif 'radiant crest' in dep_normalized:
            location = 'radiant crest'
        elif 'aurora crags' in dep_normalized:
            location = 'aurora crags'
        elif 'heavenspire peak' in dep_normalized:
            location = 'heavenspire peak'
        elif 'starlight summit' in dep_normalized:
            location = 'starlight summit'
            
        if location:
            # Find ALL files that define newborn children in this location
            matching_files = []
            for filepath in glob.glob(os.path.join(directory, "*.md")):
                with open(filepath, 'r') as f:
                    content = f.read()
                # Look for files that define "average number of newborn children per adult" in this location
                defines_match = re.search(r'_Defines:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
                if defines_match:
                    defines_text = defines_match.group(1)
                    for line in defines_text.split('\n'):
                        if line.strip().startswith('- '):
                            defined_value = line.strip()[2:].strip().lower()
                            if 'average number of newborn children per adult' in defined_value and location in defined_value:
                                matching_files.append(os.path.basename(filepath))
                                break
            # Return a special marker with all files
            if matching_files:
                return ('MULTIPLE', matching_files)
    
    # Check for "total number of adult animals" - these also need multiple links
    if 'total number of adult animals' in dep_normalized:
        location = None
        if 'jefferson circus' in dep_normalized:
            location = 'jefferson circus'
        elif 'south zoo' in dep_normalized:
            location = 'south zoo'
            
        if location:
            # First check if there's a file that explicitly defines this total
            for filepath in glob.glob(os.path.join(directory, "*.md")):
                filename = os.path.basename(filepath)
                with open(filepath, 'r') as f:
                    content = f.read()
                # Check the title line
                title_match = re.search(r'title:\s*(.+)', content)
                if title_match:
                    title = title_match.group(1).lower()
                    if 'total number of adult animals' in title and location in title:
                        return filename
            
            # If not found, find ALL files that define adult animals in this location
            matching_files = []
            for filepath in glob.glob(os.path.join(directory, "*.md")):
                with open(filepath, 'r') as f:
                    content = f.read()
                defines_match = re.search(r'_Defines:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
                if defines_match:
                    defines_text = defines_match.group(1)
                    for line in defines_text.split('\n'):
                        if line.strip().startswith('- '):
                            defined_value = line.strip()[2:].strip().lower()
                            if 'number of adult' in defined_value and location in defined_value:
                                matching_files.append(os.path.basename(filepath))
                                break
            if matching_files:
                return ('MULTIPLE', matching_files)
    
    return None

def fix_dependency_in_file(filepath, old_line, dependency_text, matching_file):
    """Remove dependency from _Still_Requires:_ and add to _Links: Parent:"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Remove the old dependency line
    new_content = content.replace(old_line + '\n', '')
    
    # Clean up empty _Still_Requires:_ section
    new_content = re.sub(r'_Still_Requires:_\s*\n\s*\n', '', new_content)
    
    # Handle multiple files case
    if isinstance(matching_file, tuple) and matching_file[0] == 'MULTIPLE':
        files_to_add = matching_file[1]
    else:
        files_to_add = [matching_file]
    
    # Add to _Links: Parent: section
    links_match = re.search(r'(_Links:_\s*\nParent:\s*\n)', new_content)
    
    if links_match:
        insert_pos = links_match.end()
        # Find the end of the Parent section
        remaining = new_content[insert_pos:]
        parent_lines = []
        for line in remaining.split('\n'):
            if line and not line.startswith('-') and not line.startswith(' '):
                break
            parent_lines.append(line)
        
        parent_section_length = sum(len(line) + 1 for line in parent_lines[:-1])
        insert_pos += parent_section_length
        
        # Add all matching files
        new_entries = ""
        for file in files_to_add:
            new_entries += f"- has_a_dependency [[{file}]]\n"
        
        new_content = new_content[:insert_pos] + new_entries + new_content[insert_pos:]
    else:
        # Create _Links: section if it doesn't exist
        new_entries = ""
        for file in files_to_add:
            new_entries += f"- has_a_dependency [[{file}]]\n"
        new_content += f"\n_Links:_\nParent:\n{new_entries}"
    
    with open(filepath, 'w') as f:
        f.write(new_content)
    
    return True

def main():
    directory = 'backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question'
    
    print(f"Finding files with unresolved dependencies in {directory}...")
    files_with_deps = get_unresolved_dependencies(directory)
    print(f"Found {len(files_with_deps)} files with dependencies")
    
    fixed_count = 0
    skipped_count = 0
    
    for filepath in files_with_deps:
        filename = os.path.basename(filepath)
        print(f"\nProcessing: {filename}")
        deps = extract_dependencies(filepath)
        
        for old_line, dep_text in deps:
            print(f"  Looking for definition of: {dep_text}")
            matching_file = find_file_that_defines(dep_text, directory)
            
            if matching_file:
                if isinstance(matching_file, tuple) and matching_file[0] == 'MULTIPLE':
                    print(f"  ✓ Found {len(matching_file[1])} files for total calculation")
                    for f in matching_file[1]:
                        print(f"    - {f}")
                else:
                    print(f"  ✓ Found in: {matching_file}")
                    
                if fix_dependency_in_file(filepath, old_line, dep_text, matching_file):
                    if isinstance(matching_file, tuple) and matching_file[0] == 'MULTIPLE':
                        fixed_count += len(matching_file[1])
                    else:
                        fixed_count += 1
            else:
                print(f"  ✗ No match found")
                skipped_count += 1
    
    print(f"\nSummary: Fixed {fixed_count} dependencies, skipped {skipped_count}")

if __name__ == "__main__":
    main()