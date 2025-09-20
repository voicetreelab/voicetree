#!/usr/bin/env python3
"""
Type checking enforcement script for VoiceTree.
Ensures no untyped dictionaries and enforces proper data structures.
"""

import subprocess
import sys
import re
from pathlib import Path
from typing import List, Tuple, Set
import ast

class DictUsageChecker(ast.NodeVisitor):
    """AST visitor to detect dictionary usage patterns."""

    def __init__(self, filename: str):
        self.filename = filename
        self.violations: List[Tuple[int, str]] = []
        self.allowed_patterns: Set[str] = {
            'TypedDict',
            'dataclass',
            'BaseModel',  # Pydantic
        }

    def visit_Dict(self, node: ast.Dict) -> None:
        """Check for raw dictionary literals."""
        line_no = node.lineno
        self.violations.append((line_no, f"Raw dictionary literal found at line {line_no}"))
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        """Check for dict() constructor calls."""
        if isinstance(node.func, ast.Name) and node.func.id == 'dict':
            line_no = node.lineno
            self.violations.append((line_no, f"dict() constructor found at line {line_no}"))
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        """Check for Dict type annotations without proper typing."""
        if self._is_dict_annotation(node.annotation):
            line_no = node.lineno
            self.violations.append((line_no, f"Dict type annotation found at line {line_no} - use dataclass or TypedDict instead"))
        self.generic_visit(node)

    def _is_dict_annotation(self, annotation) -> bool:
        """Check if annotation is a Dict type."""
        if isinstance(annotation, ast.Name) and annotation.id == 'dict':
            return True
        if isinstance(annotation, ast.Subscript):
            if isinstance(annotation.value, ast.Name) and annotation.value.id == 'Dict':
                return True
            if isinstance(annotation.value, ast.Attribute):
                if annotation.value.attr == 'Dict':
                    return True
        return False


def check_file_for_dicts(filepath: Path) -> List[Tuple[str, int, str]]:
    """Check a single Python file for dictionary usage."""
    violations = []

    try:
        with open(filepath, 'r') as f:
            content = f.read()

        # Parse the AST
        tree = ast.parse(content, filename=str(filepath))
        checker = DictUsageChecker(str(filepath))
        checker.visit(tree)

        for line_no, msg in checker.violations:
            violations.append((str(filepath), line_no, msg))

    except SyntaxError as e:
        print(f"Syntax error in {filepath}: {e}")
    except Exception as e:
        print(f"Error checking {filepath}: {e}")

    return violations


def run_mypy(target_dir: Path) -> Tuple[bool, str]:
    """Run mypy type checker."""
    cmd = ['mypy', str(target_dir), '--config-file', 'mypy.ini']

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=target_dir.parent
        )

        success = result.returncode == 0
        output = result.stdout + result.stderr

        return success, output
    except FileNotFoundError:
        return False, "mypy not installed. Run: pip install mypy"


def main():
    """Main entry point for type checking."""
    import argparse

    parser = argparse.ArgumentParser(description='VoiceTree Type Checking Enforcement')
    parser.add_argument('--exclude-tests', action='store_true', help='Exclude test files from checking')
    args = parser.parse_args()

    project_root = Path('/Users/bobbobby/repos/VoiceTree')
    backend_dir = project_root / 'backend'

    print("=" * 60)
    print("VoiceTree Type Checking Enforcement")
    print("=" * 60)

    # Step 1: Check for dictionary usage
    print("\n🔍 Checking for dictionary usage...")

    dict_violations = []
    python_files = list(backend_dir.rglob('*.py'))

    # Filter out system directories and optionally tests
    python_files = [
        f for f in python_files
        if '.venv' not in f.parts and
           '__pycache__' not in f.parts and
           (not args.exclude_tests or 'tests' not in f.parts)
    ]

    if args.exclude_tests:
        python_files = [
            f for f in python_files
            if '/tests/' not in str(f) and not f.name.startswith('test_')
        ]
        print(f"Excluding test files. Checking {len(python_files)} non-test files.")
    else:
        print(f"Checking all {len(python_files)} Python files.")

    for filepath in python_files:
        violations = check_file_for_dicts(filepath)
        dict_violations.extend(violations)

    if dict_violations:
        print(f"\n❌ Found {len(dict_violations)} dictionary usage violations:\n")
        for filepath, line_no, msg in dict_violations[:10]:  # Show first 10
            relative_path = Path(filepath).relative_to(project_root)
            print(f"  {relative_path}:{line_no} - {msg}")

        if len(dict_violations) > 10:
            print(f"\n  ... and {len(dict_violations) - 10} more violations")
    else:
        print("✅ No dictionary usage violations found!")

    # Step 2: Run mypy
    print("\n🔍 Running mypy type checker...")

    success, output = run_mypy(backend_dir)

    if success:
        print("✅ Type checking passed!")
    else:
        print("❌ Type checking failed!\n")

        # Parse and display key errors
        lines = output.split('\n')
        error_lines = [l for l in lines if 'error' in l.lower()][:10]

        for line in error_lines:
            print(f"  {line}")

        if len(error_lines) < len([l for l in lines if 'error' in l.lower()]):
            remaining = len([l for l in lines if 'error' in l.lower()]) - 10
            print(f"\n  ... and {remaining} more errors")

    # Summary
    print("\n" + "=" * 60)
    total_issues = len(dict_violations) + (0 if success else 1)

    if total_issues == 0:
        print("✅ All type checks passed! Code is properly typed.")
        return 0
    else:
        print(f"❌ Found {total_issues} type-related issues to fix.")
        print("\nRecommendations:")
        print("1. Replace Dict with dataclasses or TypedDict")
        print("2. Add type hints to all function signatures")
        print("3. Use proper type annotations for variables")
        print("4. Run 'mypy backend/' to see detailed type errors")
        return 1


if __name__ == "__main__":
    sys.exit(main())