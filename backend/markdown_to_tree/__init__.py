"""
Markdown to Tree Module

A module for loading and parsing markdown nodes from the filesystem.
Extracts existing functions from tools/graph_dependency_traversal_and_accumulate_graph_content.py
"""

import re
from pathlib import Path
from typing import Dict


def read_markdown_file(filepath: Path) -> str:
    """
    Read content from a markdown file, returning empty string if not found.
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py
    """
    try:
        return filepath.read_text(encoding='utf-8')
    except FileNotFoundError:
        print(f"Warning: File not found: {filepath}")
        return ""


def extract_markdown_links(content: str) -> list[str]:
    """
    Extract all markdown links from content, e.g., [[file.md]] or [[file.md|title]].
    Extracted from tools/graph_dependency_traversal_and_accumulate_graph_content.py
    """
    pattern = r'\[\[([^\]|]+\.md)(?:\|[^\|]+)?\]\]'
    return re.findall(pattern, content)


def extract_title(content: str) -> str:
    """
    Extract title from markdown frontmatter.
    Looks for 'title: Title Name' in YAML frontmatter.
    """
    # Look for title in YAML frontmatter
    match = re.search(r'^title:\s*(.+?)(?:\s*\(.+\))?$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    
    # Fallback: look for first # heading
    match = re.search(r'^#\s+(.+?)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    
    return ""


def extract_summary(content: str) -> str:
    """
    Extract summary from first ### heading content.
    Gets the text immediately following the first ### heading.
    """
    # Find the first ### heading line
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
    """
    match = re.search(r'^node_id:\s*(.+?)$', content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return ""


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