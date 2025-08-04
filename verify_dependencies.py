#!/usr/bin/env python3
"""
Verify that all dependencies have been fixed
"""

import os
import re
import glob

def check_dependencies(directory):
    """Check for remaining text dependencies in markdown files."""
    
    text_deps_count = 0
    linked_deps_count = 0
    files_checked = 0
    
    for filepath in glob.glob(os.path.join(directory, "*.md")):
        files_checked += 1
        with open(filepath, 'r') as f:
            content = f.read()
        
        # Check _Requires:_ sections
        requires_match = re.search(r'_Requires:_\s*\n(.*?)(?:\n\n|_Still_Requires:|_Links:|$)', content, re.DOTALL)
        if requires_match:
            deps_text = requires_match.group(1)
            for line in deps_text.split('\n'):
                if line.strip().startswith('- '):
                    dep = line.strip()[2:].strip()
                    if dep.startswith('[[') and dep.endswith(']]'):
                        linked_deps_count += 1
                    elif dep:
                        text_deps_count += 1
                        print(f"Text dependency found in {os.path.basename(filepath)}: {dep}")
        
        # Check for _Still_Requires:_ sections
        if '_Still_Requires:_' in content:
            print(f"_Still_Requires:_ section found in {os.path.basename(filepath)}")
    
    print(f"\nSummary:")
    print(f"Files checked: {files_checked}")
    print(f"Linked dependencies: {linked_deps_count}")
    print(f"Text dependencies: {text_deps_count}")
    print(f"All dependencies converted: {'✓ Yes' if text_deps_count == 0 else '✗ No'}")

if __name__ == "__main__":
    directory = 'backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question'
    check_dependencies(directory)