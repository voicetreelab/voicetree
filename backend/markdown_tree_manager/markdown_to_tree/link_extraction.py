"""
Link extraction utilities for markdown content.

This module handles extracting markdown links from content.
"""

import re


def extract_markdown_links(content: str) -> list[str]:
    """
    Extract all markdown links from content, e.g., [[file.md]] or [[file.md|title]].
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py

    Args:
        content: Markdown content to extract links from

    Returns:
        List of linked markdown filenames
    """
    pattern = r'\[\[([^\]|]+\.md)(?:\|[^\|]+)?\]\]'
    return re.findall(pattern, content)
