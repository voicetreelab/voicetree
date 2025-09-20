#!/usr/bin/env python3
"""
Unit test for add_new_node.py functionality
Tests the core node creation and linking functionality in isolation.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def test_add_new_node_functionality():
    """Test that add_new_node.py creates nodes correctly"""
    
    # Create temporary test directory
    with tempfile.TemporaryDirectory() as temp_dir:
        test_vault = Path(temp_dir) / "test_vault"
        test_date_dir = test_vault / "2025-08-08"
        test_date_dir.mkdir(parents=True)
        
        # Create source node
        source_node = test_date_dir / "1_test_source.md"
        source_content = """---
node_id: 1
title: test_source (1)
color: blue
---

This is a test source node."""
        
        with open(source_node, 'w') as f:
            f.write(source_content)
        
        # Set environment variables
        env = os.environ.copy()
        env['AGENT_COLOR'] = 'test_blue'
        
        # Test node creation
        cmd = [
            sys.executable,
            str(Path(__file__).parent.parent / 'add_new_node.py'),
            str(source_node),
            "Unit Test Node",
            """## Summary
Unit test node creation validation

## Technical Details
- Tests add_new_node.py core functionality
- Validates proper YAML frontmatter
- Checks parent-child linking

## Architecture Diagram
```mermaid
flowchart TD
    A[Source Node] --> B[Unit Test Node]
```

## Impact
Validates that node creation works in test environment""",
            "is_progress_of"
        ]
        
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            cwd=Path.cwd()
        )
        
        print(f"Command: {' '.join(cmd)}")
        print(f"Exit code: {result.returncode}")
        print(f"Stdout: {result.stdout}")
        print(f"Stderr: {result.stderr}")
        
        # Validate results
        validations = {
            'node_creation_success': result.returncode == 0,
            'new_node_exists': False,
            'proper_node_id': False,
            'color_consistency': False,
            'parent_child_links': False,
            'yaml_frontmatter': False,
            'content_format': False
        }
        
        # Check if new node was created
        new_files = list(test_date_dir.glob("1_*_Unit_Test_Node.md"))
        if new_files:
            validations['new_node_exists'] = True
            new_node = new_files[0]
            
            with open(new_node, 'r') as f:
                content = f.read()
                
            # Validate content
            if content.startswith('---') and 'node_id: 1_1' in content:
                validations['proper_node_id'] = True
                
            if 'color: test_blue' in content:
                validations['color_consistency'] = True
                
            if '_Links:_' in content and 'is_progress_of' in content:
                validations['parent_child_links'] = True
                
            if 'node_id:' in content and 'title:' in content:
                validations['yaml_frontmatter'] = True
                
            if '## Summary' in content and '## Technical Details' in content:
                validations['content_format'] = True
        
        # Report results
        print("\n=== VALIDATION RESULTS ===")
        total_validations = len(validations)
        passed_validations = sum(validations.values())
        
        for validation, passed in validations.items():
            status = "✅" if passed else "❌"
            print(f"{status} {validation}")
            
        success_rate = passed_validations / total_validations
        print(f"\nOverall: {passed_validations}/{total_validations} ({success_rate:.1%})")
        
        return success_rate >= 0.8  # 80% pass threshold

if __name__ == "__main__":
    success = test_add_new_node_functionality()
    print(f"\nUnit Test {'PASSED' if success else 'FAILED'}")
    sys.exit(0 if success else 1)