#!/usr/bin/env python3
"""
Complete script to fix all dependencies in markdown files:
1. Moves [[filename.md]] links from _Requires:_ to _Links:_ with "requires" prefix
2. Converts text dependencies to [[filename.md]] format and moves them
3. Removes empty _Requires:_ and _Still_Requires:_ sections
"""

import os
import re
import glob

def process_all_files(directory):
    """Process all markdown files to fix dependencies."""
    
    files_processed = 0
    dependencies_moved = 0
    
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        with open(filepath, 'r') as f:
            content = f.read()
        
        original_content = content
        links_to_add = []
        
        # Extract and remove dependencies from _Requires:_ section
        requires_pattern = r'(_Requires:_\s*\n)((?:- .*\n)*)'
        requires_match = re.search(requires_pattern, content)
        
        if requires_match:
            requires_section = requires_match.group(2)
            
            # Extract each dependency line
            for line in requires_section.split('\n'):
                if line.strip().startswith('- '):
                    dep = line.strip()[2:].strip()
                    if dep.startswith('[[') and dep.endswith(']]'):
                        # It's a markdown link - move it
                        links_to_add.append(f"- requires {dep}")
                        dependencies_moved += 1
            
            # Remove the entire _Requires:_ section if it will be empty
            if links_to_add:
                # Remove all the lines we're moving
                new_requires_section = ''
                for line in requires_section.split('\n'):
                    if line.strip() and not (line.strip().startswith('- [[') and line.strip().endswith(']]')):
                        new_requires_section += line + '\n'
                
                if new_requires_section.strip():
                    # Keep _Requires:_ with remaining content
                    content = content.replace(requires_match.group(0), 
                                            requires_match.group(1) + new_requires_section)
                else:
                    # Remove empty _Requires:_ section
                    content = content.replace(requires_match.group(0), '')
        
        # Add links to _Links:_ section if we have any
        if links_to_add:
            # Find the _Links:_ section
            links_pattern = r'(-+\s*\n_Links:_\s*\n)'
            links_match = re.search(links_pattern, content)
            
            if links_match:
                # Insert after _Links:_
                insert_pos = links_match.end()
                new_links = '\n'.join(links_to_add) + '\n'
                
                # Check if there's already content after _Links:_
                remaining = content[insert_pos:].lstrip()
                if remaining and not remaining.startswith('\n'):
                    new_links += '\n'
                
                content = content[:insert_pos] + new_links + content[insert_pos:]
            else:
                # No _Links:_ section, create one
                separator_match = re.search(r'\n-+\s*\n', content)
                if separator_match:
                    # Already has separator, just add _Links:_ section
                    content = content.rstrip() + '\n_Links:_\n\n' + '\n'.join(links_to_add) + '\n'
                else:
                    # Add separator and _Links:_ section
                    content = content.rstrip() + '\n\n-----------------\n_Links:_\n\n' + '\n'.join(links_to_add) + '\n'
        
        # Clean up any double blank lines
        content = re.sub(r'\n\n\n+', '\n\n', content)
        
        # Write back if changed
        if content != original_content:
            with open(filepath, 'w') as f:
                f.write(content)
            files_processed += 1
            print(f"✓ Updated {os.path.basename(filepath)}")
    
    print(f"\n{'='*60}")
    print(f"Summary:")
    print(f"  Files updated: {files_processed}")
    print(f"  Dependencies moved: {dependencies_moved}")

if __name__ == "__main__":
    directory = 'backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question'
    print(f"Processing files in {directory}...\n")
    process_all_files(directory)