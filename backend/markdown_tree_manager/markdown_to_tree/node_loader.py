"""
Node loading functionality for markdown files.

This module provides the main interface for loading and parsing markdown nodes,
combining file operations, link extraction, and metadata extraction.
"""

from pathlib import Path
from typing import Dict

from .file_operations import read_markdown_file
from .link_extraction import extract_markdown_links
from .metadata_extraction import extract_node_id, extract_title, extract_summary


def load_node(filename: str, markdown_dir: Path) -> Dict[str, str]:
    """
    Load and parse a markdown node - shared by both pipelines.
    Combines all parsing functions into a single interface.
    
    Args:
        filename: The markdown filename (e.g., '20_Dependency_Traversal.md')
        markdown_dir: Path to the directory containing markdown files
        
    Returns:
        Dictionary with node data:
        {
            'filename': '20_Dependency_Traversal.md',
            'node_id': '20',
            'title': 'Dependency Traversal for Relevant Nodes',
            'summary': 'Performs an MVP dependency traversal...',
            'content': '---\nnode_id: 20\n...',
            'links': ['19_Parent.md', '21_Child.md']
        }
    """
    filepath = markdown_dir / filename
    content = read_markdown_file(filepath)
    
    if not content:
        return {
            'filename': filename,
            'node_id': '',
            'title': '',
            'summary': '',
            'content': '',
            'links': []
        }
    
    # Extract metadata from frontmatter and content
    node_id = extract_node_id(content)
    title = extract_title(content)
    summary = extract_summary(content)
    links = extract_markdown_links(content)
    
    return {
        'filename': filename,
        'node_id': node_id,
        'title': title,
        'summary': summary,
        'content': content,
        'links': links
    }