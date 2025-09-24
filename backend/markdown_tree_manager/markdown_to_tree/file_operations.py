"""
File operations for markdown files.

This module handles reading markdown files from the filesystem.
"""

from pathlib import Path


def read_markdown_file(filepath: Path) -> str:
    """
    Read content from a markdown file, returning empty string if not found.
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py

    Args:
        filepath: Path to the markdown file

    Returns:
        File content as string, or empty string if file not found
    """
    try:
        return filepath.read_text(encoding='utf-8')
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
        return ""
