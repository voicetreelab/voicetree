#!/usr/bin/env python3
"""
Script to fix forward unresolved dependencies in markdown files by converting 
text dependencies to [[filename.md]] format using tag-based search.
"""

import os
import re
import subprocess
import glob

def get_unresolved_dependencies(directory):
    """Get all files with _Still_Requires:_ dependencies."""
    result = subprocess.run(['grep', '-r', '_Still_Requires:_', directory], 
                          capture_output=True, text=True)
    files_with_deps = []
    for line in result.stdout.split('\n'):
        if line.strip() and ':' in line:
            filepath = line.split(':')[0]
            if filepath not in files_with_deps:
                files_with_deps.append(filepath)
    return files_with_deps

def extract_dependency_text(filepath):
    """Extract all dependencies from a file, both text and linked format."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Find _Still_Requires:_ section
    match = re.search(r'_Still_Requires:_\s*\n(.*?)\n\n', content, re.DOTALL)
    if match:
        deps_text = match.group(1)
        # Extract each dependency (lines starting with -)
        deps = []
        for line in deps_text.split('\n'):
            if line.strip().startswith('- '):
                dep = line.strip()[2:].strip()
                # Handle both text dependencies and already-linked ones
                if dep.startswith('[[') and dep.endswith('.md]]'):
                    # Already linked - extract filename
                    filename = dep[2:-2]  # Remove [[ and ]]
                    deps.append((line.strip(), dep, filename, True))
                else:
                    # Text dependency
                    deps.append((line.strip(), dep, None, False))
        return deps
    return []

def find_matching_file_by_tags(dependency_text, directory):
    """Find a matching file using tag-based search."""
    # Extract key terms for tag searching
    key_terms = []
    
    # Look for specific patterns
    if 'adult' in dependency_text.lower():
        # Extract animal type
        words = dependency_text.lower().replace('number of', '').replace('average', '').replace('newborn children per', '').strip().split()
        for i, word in enumerate(words):
            if word == 'adult':
                if i + 1 < len(words):
                    animal = words[i + 1]
                    # Handle compound animal names
                    if i + 2 < len(words) and words[i + 2] not in ['in', 'at']:
                        animal += '_' + words[i + 2]
                    key_terms.append(f'adult_{animal}')
                break
    
    # Extract location
    if ' in ' in dependency_text.lower():
        location_part = dependency_text.lower().split(' in ')[-1].strip()
        # Clean up location name
        location = location_part.replace(' ', '_').replace('.', '')
        key_terms.append(location)
    
    if not key_terms:
        print(f"Could not extract key terms from: {dependency_text}")
        return None
    
    # Search for files with these tags
    try:
        result = subprocess.run(['python', 'find_files_by_tags_OR.py', directory] + key_terms,
                              capture_output=True, text=True, cwd='.')
        
        if result.returncode == 0:
            output = result.stdout
            # Look for files that match both tags
            lines = output.split('\n')
            for i, line in enumerate(lines):
                if line.strip().startswith(directory.split('/')[-1] + '/') and 'Matched tags:' in lines[i+1]:
                    tags_line = lines[i+1]
                    # Check if it has most of our key terms
                    matched_tags = tags_line.split(': ')[1].split(', ')
                    matched_count = sum(1 for term in key_terms if f'#{term}' in matched_tags)
                    if matched_count >= len(key_terms) // 2:  # At least half the key terms
                        filename = line.strip().split('/')[-1]
                        return filename
    except Exception as e:
        print(f"Error searching for {dependency_text}: {e}")
    
    return None

def fix_dependency_in_file(filepath, old_line, dependency_text, matching_file):
    """Remove dependency from _Still_Requires:_ and add to _Links: Parent:"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # First, remove the old dependency line from _Still_Requires:_
    new_content = content.replace(old_line, '')
    
    # Clean up empty _Still_Requires:_ section if it's now empty
    still_requires_pattern = r'_Still_Requires:_\s*\n\s*\n'
    if re.search(still_requires_pattern, new_content):
        new_content = re.sub(still_requires_pattern, '', new_content)
    
    # Add the dependency to _Links: Parent: section
    links_pattern = r'(_Links:_\s*\nParent:\s*\n)'
    match = re.search(links_pattern, new_content)
    
    if match:
        # Find the end of the Parent section
        insert_pos = match.end()
        remaining_content = new_content[insert_pos:]
        
        # Find where the Parent section ends (next section or end of file)
        parent_section_lines = []
        for line in remaining_content.split('\n'):
            if line.strip() and not line.startswith('-') and not line.strip() == '':
                # Found start of next section
                break
            parent_section_lines.append(line)
        
        # Calculate where to insert
        parent_section_length = sum(len(line) + 1 for line in parent_section_lines[:-1])  # -1 for last newline
        
        # Check if there are existing entries
        has_entries = any(line.strip().startswith('-') for line in parent_section_lines)
        
        if has_entries:
            # Add after existing entries
            insert_pos += parent_section_length
            new_entry = f"- has_a_dependency [[{matching_file}]]\n"
        else:
            # Add as first entry
            new_entry = f"- has_a_dependency [[{matching_file}]]\n"
        
        new_content = new_content[:insert_pos] + new_entry + new_content[insert_pos:]
    else:
        # No _Links: section found, create one
        new_content += f"\n_Links:_\nParent:\n- has_a_dependency [[{matching_file}]]\n"
    
    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        return True
    return False

def main():
    directory = 'backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question'
    
    print("Finding files with unresolved dependencies...")
    files_with_deps = get_unresolved_dependencies(directory)
    print(f"Found {len(files_with_deps)} files with dependencies")
    
    fixed_count = 0
    skipped_count = 0
    
    for filepath in files_with_deps:
        print(f"\nProcessing: {filepath}")
        deps = extract_dependency_text(filepath)
        
        for dep_info in deps:
            if len(dep_info) == 4:  # New format with is_linked flag
                old_line, dep_text, filename, is_linked = dep_info
                
                if is_linked:
                    # Already linked - just move it
                    print(f"  Moving linked dependency: {filename}")
                    if fix_dependency_in_file(filepath, old_line, dep_text, filename):
                        print(f"  ✓ Moved dependency")
                        fixed_count += 1
                    else:
                        print(f"  ✗ Failed to move dependency")
                else:
                    # Text dependency - need to find matching file
                    print(f"  Looking for: {dep_text}")
                    matching_file = find_matching_file_by_tags(dep_text, directory)
                    
                    if matching_file:
                        print(f"  Found match: {matching_file}")
                        
                        if fix_dependency_in_file(filepath, old_line, dep_text, matching_file):
                            print(f"  ✓ Fixed dependency")
                            fixed_count += 1
                        else:
                            print(f"  ✗ Failed to replace in file")
                    else:
                        print(f"  ✗ No match found")
                        skipped_count += 1
    
    print(f"\nSummary: Fixed {fixed_count} dependencies, skipped {skipped_count}")

if __name__ == "__main__":
    main()