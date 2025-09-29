#!/usr/bin/env python3
"""
Check for potentially problematic Path(__file__) usage in Python files.

This script detects patterns like Path(__file__).parent which can break
in packaged/frozen environments (e.g., Electron dist builds).
"""

import ast
import sys
from pathlib import Path
from typing import Any


class PathFileChecker(ast.NodeVisitor):
    """AST visitor to check for Path(__file__) usage."""

    def __init__(self, filename: str) -> None:
        self.filename = filename
        self.issues: list[tuple[int, int, str]] = []

    def visit_Call(self, node: ast.Call) -> Any:
        """Visit Call nodes to find Path(__file__) patterns."""
        if (isinstance(node.func, ast.Name) and node.func.id == 'Path' and
            len(node.args) == 1):
            arg = node.args[0]
            if isinstance(arg, ast.Name) and arg.id == '__file__':
                self.issues.append((
                    node.lineno,
                    node.col_offset,
                    "Path(__file__) usage detected - may break in packaged environments"
                ))

        self.generic_visit(node)
        return node


def check_file(filepath: Path) -> list[tuple[str, int, int, str]]:
    """Check a single Python file for Path(__file__) usage."""
    try:
        content = filepath.read_text()
        tree = ast.parse(content, filename=str(filepath))

        checker = PathFileChecker(str(filepath))
        checker.visit(tree)

        return [(str(filepath), line, col, msg)
                for line, col, msg in checker.issues]
    except (SyntaxError, UnicodeDecodeError):
        return []


def main() -> int:
    """Main entry point."""
    if len(sys.argv) > 1:
        paths = [Path(arg) for arg in sys.argv[1:]]
    else:
        paths = [Path.cwd()]

    all_issues: list[tuple[str, int, int, str]] = []

    for path in paths:
        if path.is_file() and path.suffix == '.py':
            all_issues.extend(check_file(path))
        elif path.is_dir():
            for py_file in path.rglob('*.py'):
                if 'dist-electron' not in str(py_file) and 'node_modules' not in str(py_file):
                    all_issues.extend(check_file(py_file))

    if all_issues:
        print("Found Path(__file__) usage that may break in packaged environments:")
        print("=" * 70)
        for filepath, line, col, msg in sorted(all_issues):
            print(f"{filepath}:{line}:{col}: {msg}")
        print("=" * 70)
        print(f"Total issues: {len(all_issues)}")
        print("\nConsider using:")
        print("  - Environment variables for configuration paths")
        print("  - Absolute paths from a configuration file")
        print("  - importlib.resources for package data")
        return 1
    else:
        print("✓ No problematic Path(__file__) usage found")
        return 0


if __name__ == "__main__":
    sys.exit(main())