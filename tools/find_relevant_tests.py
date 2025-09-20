#!/usr/bin/env python3
"""
Tool to find test files that are dependent on given production files.
Helps identify which tests need to be checked when modifying production code.
"""

import ast
import importlib.util
import os
import sys
from pathlib import Path
from typing import Dict
from typing import List
from typing import Set


def get_import_paths(file_path: Path) -> Set[str]:
    """Extract all import paths from a Python file."""
    imports = set()

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        tree = ast.parse(content)

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.add(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.add(node.module)
                    # Also add submodules
                    for alias in node.names:
                        imports.add(f"{node.module}.{alias.name}")

    except (SyntaxError, UnicodeDecodeError, FileNotFoundError):
        pass

    return imports


def file_to_module_path(file_path: Path, root_dir: Path) -> str:
    """Convert a file path to a Python module path."""
    relative_path = file_path.relative_to(root_dir)

    # Remove .py extension
    if relative_path.suffix == '.py':
        relative_path = relative_path.with_suffix('')

    # Convert path separators to dots
    module_path = str(relative_path).replace(os.sep, '.')

    # Remove __init__ if present
    if module_path.endswith('.__init__'):
        module_path = module_path[:-9]

    return module_path


def find_tests_for_files(production_files: List[str]) -> Dict[str, List[str]]:
    """Find test files that import or depend on the given production files."""
    project_root = Path.cwd()
    test_dirs = [
        project_root / "backend" / "tests",
        project_root / "tests"
    ]

    # Convert production files to module paths
    prod_modules = set()
    for prod_file in production_files:
        prod_path = Path(prod_file)
        if prod_path.is_absolute():
            prod_path = prod_path.relative_to(project_root)

        module_path = file_to_module_path(prod_path, project_root)
        prod_modules.add(module_path)

        # Also add parent modules (for from X import Y cases)
        parts = module_path.split('.')
        for i in range(1, len(parts)):
            parent_module = '.'.join(parts[:i])
            prod_modules.add(parent_module)

    results = {prod_file: [] for prod_file in production_files}

    # Find all test files
    test_files = []
    for test_dir in test_dirs:
        if test_dir.exists():
            test_files.extend(test_dir.rglob("test_*.py"))
            test_files.extend(test_dir.rglob("*_test.py"))

    # Check each test file for dependencies
    for test_file in test_files:
        test_imports = get_import_paths(test_file)

        # Check if this test imports any of our production modules
        for prod_file in production_files:
            prod_path = Path(prod_file)
            if prod_path.is_absolute():
                prod_path = prod_path.relative_to(project_root)

            prod_module = file_to_module_path(prod_path, project_root)

            # Check for direct imports or parent module imports
            for test_import in test_imports:
                if (test_import == prod_module or
                    test_import.startswith(prod_module + '.') or
                    prod_module.startswith(test_import + '.')):

                    relative_test_path = str(test_file.relative_to(project_root))
                    if relative_test_path not in results[prod_file]:
                        results[prod_file].append(relative_test_path)
                    break

    return results


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python find_relevant_tests.py <file1> [file2] [file3] ...")
        print("Example: python find_relevant_tests.py backend/context_retrieval/dependency_traversal.py")
        sys.exit(1)

    production_files = sys.argv[1:]

    print(f"Finding tests for {len(production_files)} production file(s):")
    for f in production_files:
        print(f"  - {f}")
    print()

    results = find_tests_for_files(production_files)

    all_tests = set()
    for prod_file, test_files in results.items():
        print(f"📁 {prod_file}")
        if test_files:
            for test_file in test_files:
                print(f"  🧪 {test_file}")
                all_tests.add(test_file)
        else:
            print("  ❌ No tests found")
        print()

    if all_tests:
        print(f"📊 Summary: {len(all_tests)} unique test files found")
        print("🚀 To run all relevant tests:")
        print(f"pytest {' '.join(sorted(all_tests))}")
    else:
        print("❌ No relevant tests found for any of the specified files")


if __name__ == "__main__":
    main()