"""
Metadata extraction utilities for markdown content.

This module handles extracting metadata like title, summary, and node_id
from markdown files with YAML frontmatter.
"""

import re


def extract_title(content: str) -> str:
    """
    Extract title from markdown content.
    Looks for the first markdown heading (# Title).

    Args:
        content: Markdown content

    Returns:
        Extracted title or empty string if not found
    """
    # Look for first # heading (any level)
    match = re.search(r'^#+\s+(.+?)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()

    return ""


def extract_summary(content: str) -> str:
    """
    Extract summary from the second heading (### level).
    The first heading is the title, the second (###) is the summary.

    Args:
        content: Markdown content

    Returns:
        Extracted summary or empty string if not found
    """
    # Find the first ### heading line (second heading after # title)
    match = re.search(r'^###\s+(.+?)$', content, re.MULTILINE)

    if match:
        return match.group(1).strip()

    # Fallback: look for any content after "Summary" section
    match = re.search(r'\*\*\s*Summary\s*\*\*\s*\n(.*?)(?=\n\*\*|\Z)', content, re.DOTALL)
    if match:
        summary_content = match.group(1).strip()
        lines = [line.strip() for line in summary_content.split('\n') if line.strip()]
        return ' '.join(lines)

    return ""


def extract_node_id(content: str) -> str:
    """
    Extract node_id from markdown frontmatter.
    Looks for 'node_id: ID' in YAML frontmatter.

    Args:
        content: Markdown content with frontmatter

    Returns:
        Extracted node_id or empty string if not found
    """
    match = re.search(r'^node_id:\s*(.+?)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return ""
