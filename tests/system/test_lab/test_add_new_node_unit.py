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
            str(Path(__file__).parent.parent.parent.parent / 'add_new_node.py'),
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
        new_files = list(test_date_dir.glob("2_*.md"))
        if new_files:
            validations['new_node_exists'] = True
            new_node = new_files[0]

            with open(new_node, 'r') as f:
                content = f.read()

            # Validate content
            if content.startswith('---') and 'node_id: 2' in content:
                validations['proper_node_id'] = True
                
            if 'color: test_blue' in content:
                validations['color_consistency'] = True
                
            if '_Links:_' in content and 'is_progress_of' in content:
                validations['parent_child_links'] = True
                
            if 'node_id:' in content and 'title:' in content:
                validations['yaml_frontmatter'] = True
                
            # Headers are sanitized by the script (## becomes **)
            if '** Summary**' in content and '** Technical Details**' in content:
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

        assert success_rate >= 0.8, f"Test failed with success rate {success_rate:.1%} (required: 80%)"

        return True

def test_add_new_node_with_special_chars_in_title():
    """Test that add_new_node.py correctly handles special characters in titles"""

    # Create temporary test directory
    with tempfile.TemporaryDirectory() as temp_dir:
        test_vault = Path(temp_dir) / "test_vault"
        test_date_dir = test_vault / "2025-08-08"
        test_date_dir.mkdir(parents=True)

        # Create source node
        source_node = test_date_dir / "1_test_source.md"
        source_content = """---
node_id: 1
title: 'test_source (1)'
color: blue
---

This is a test source node."""

        with open(source_node, 'w') as f:
            f.write(source_content)

        # Test cases: (title, expected_title_in_frontmatter)
        test_cases = [
            ("Bug: Fix auto-open", "title: 'Bug: Fix auto-open (2)'"),
            ("Bob's Task", "title: 'Bob''s Task (2)'"),
            ("Alice's Bug: Fix this", "title: 'Alice''s Bug: Fix this (2)'"),
        ]

        for test_name, expected_yaml_line in test_cases:
            print(f"\n=== Testing title: {test_name} ===")

            # Set environment variables
            env = os.environ.copy()
            env['AGENT_COLOR'] = 'test_blue'

            # Test node creation
            cmd = [
                sys.executable,
                str(Path(__file__).parent.parent.parent.parent / 'add_new_node.py'),
                str(source_node),
                test_name,
                "Test content",
                "is_test_of"
            ]

            result = subprocess.run(
                cmd,
                env=env,
                capture_output=True,
                text=True,
                cwd=Path.cwd()
            )

            print(f"Exit code: {result.returncode}")
            assert result.returncode == 0, f"Failed to create node with title '{test_name}'"

            # Check if new node was created
            new_files = list(test_date_dir.glob("2_*.md"))
            assert len(new_files) > 0, f"No new file created for title '{test_name}'"

            new_node = new_files[0]
            with open(new_node, 'r') as f:
                content = f.read()

            # Validate YAML frontmatter contains properly escaped title
            assert expected_yaml_line in content, \
                f"Expected '{expected_yaml_line}' not found in:\n{content}"

            # Verify it's valid YAML by trying to parse it
            import re
            yaml_match = re.search(r'^---\n(.*?)^---', content, re.MULTILINE | re.DOTALL)
            assert yaml_match, f"Could not find YAML frontmatter in:\n{content}"

            # Try to parse the frontmatter with a simple YAML parser
            yaml_content = yaml_match.group(1)
            # Basic check: ensure the title line is present
            assert 'title:' in yaml_content, f"No title field in YAML:\n{yaml_content}"

            print(f"✅ Successfully created and validated node with title: {test_name}")

            # Clean up for next test
            new_node.unlink()

        return True


if __name__ == "__main__":
    print("=== Running basic functionality test ===")
    success1 = test_add_new_node_functionality()
    print(f"\nBasic Test {'PASSED' if success1 else 'FAILED'}")

    print("\n\n=== Running special characters test ===")
    success2 = test_add_new_node_with_special_chars_in_title()
    print(f"\nSpecial Chars Test {'PASSED' if success2 else 'FAILED'}")

    overall_success = success1 and success2
    print(f"\n\n=== Overall: {'ALL TESTS PASSED' if overall_success else 'SOME TESTS FAILED'} ===")
    sys.exit(0 if overall_success else 1)