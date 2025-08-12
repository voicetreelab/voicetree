"""
Markdown to Tree Module

A module for loading and parsing markdown nodes from the filesystem.
Provides utilities for extracting metadata, links, and content from markdown files.
"""

# Import main functions for backwards compatibility
from .file_operations import read_markdown_file
from .link_extraction import extract_markdown_links
from .metadata_extraction import extract_node_id, extract_summary, extract_title
from .node_loader import load_node

# Export all public functions
__all__ = [
    'read_markdown_file',
    'extract_markdown_links',
    'extract_title',
    'extract_summary',
    'extract_node_id',
    'load_node',
]