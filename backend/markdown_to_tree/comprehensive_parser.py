"""
Comprehensive markdown file parser.

This module provides complete parsing of markdown files including
YAML frontmatter, tags, content, and relationships.
"""

import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from datetime import datetime

from .file_operations import read_markdown_file
from .yaml_parser import extract_frontmatter, extract_tags
from .metadata_extraction import extract_node_id, extract_title, extract_summary
from .link_extraction import extract_markdown_links


def parse_markdown_file_complete(filepath: Path) -> Dict:
    """
    Completely parse a markdown file extracting all metadata and content.
    
    Args:
        filepath: Path to the markdown file
        
    Returns:
        Dictionary with all parsed data including:
        - node_id, title, summary, content
        - tags, created_at, modified_at, color
        - links, parent_info
    """
    content = read_markdown_file(filepath)
    if not content:
        return None
    
    # Extract tags if present on first line
    tags, content_after_tags = extract_tags(content)
    
    # Extract YAML frontmatter
    metadata, content_after_frontmatter = extract_frontmatter(content_after_tags)
    if not metadata:
        return None
    
    # Extract node_id (try both methods)
    node_id_str = extract_node_id(content_after_tags)
    if node_id_str:
        try:
            node_id = int(node_id_str)
        except ValueError:
            node_id = node_id_str
    else:
        node_id = metadata.get('node_id')
        if node_id is None:
            return None
    
    # Get title from metadata (preserves full title with ID)
    title = metadata.get('title', 'Untitled')
    
    # Extract summary and parse content
    summary, main_content = extract_summary_and_main_content(content_after_frontmatter)
    
    # Extract datetime fields
    created_at = metadata.get('created_at', datetime.now().isoformat())
    modified_at = metadata.get('modified_at', datetime.now().isoformat())
    
    # Convert ISO strings to datetime if needed
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    if isinstance(modified_at, str):
        modified_at = datetime.fromisoformat(modified_at)
    
    # Extract links
    links = extract_markdown_links(content)
    
    # Parse parent relationship from Links section
    parent_info = extract_parent_relationship(content)
    
    return {
        'node_id': node_id,
        'title': title,
        'summary': summary,
        'content': main_content,
        'tags': tags,
        'created_at': created_at,
        'modified_at': modified_at,
        'color': metadata.get('color'),
        'links': links,
        'parent_info': parent_info,
        'filename': filepath.name
    }


def extract_summary_and_main_content(markdown_content: str) -> Tuple[str, str]:
    """
    Extract summary and main content from markdown after frontmatter.
    
    Args:
        markdown_content: Markdown content after frontmatter
        
    Returns:
        Tuple of (summary, main_content)
    """
    lines = markdown_content.strip().split('\n')
    summary = ""
    content_lines = []
    found_summary = False
    
    for line in lines:
        # Check if line is a summary (starts with ###)
        if line.strip().startswith('###') and not found_summary:
            summary = line.strip().lstrip('#').strip()
            found_summary = True
            # Skip the summary line
            continue
        elif line.strip() == '-----------------':
            # Stop before the links section
            break
        else:
            content_lines.append(line)
    
    # Join content lines
    content = '\n'.join(content_lines).strip()
    
    return summary, content


def extract_parent_relationship(content: str) -> Optional[Dict]:
    """
    Extract parent relationship from the Links section.
    
    Args:
        content: Full markdown content
        
    Returns:
        Dictionary with parent_filename and relationship_type, or None
    """
    links_match = re.search(r'_Links:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
    if not links_match:
        return None
    
    links_content = links_match.group(1)
    
    # Parse parent relationship
    parent_match = re.search(r'Parent:\s*\n.*?-\s*(.+?)\s*\[\[(.*?)\]\]', links_content)
    if parent_match:
        relationship_type = parent_match.group(1).strip()
        parent_filename = parent_match.group(2).strip()
        return {
            'parent_filename': parent_filename,
            'relationship_type': relationship_type.replace('_', ' ')
        }
    
    return None


def parse_relationships_from_links(content: str) -> Dict:
    """
    Parse all relationships from the Links section.
    
    Args:
        content: Full markdown content
        
    Returns:
        Dictionary with parent and children relationships
    """
    links_match = re.search(r'_Links:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
    if not links_match:
        return {'parent': None, 'children': []}
    
    links_content = links_match.group(1)
    result = {'parent': None, 'children': []}
    
    # Parse parent relationship
    parent_info = extract_parent_relationship(content)
    if parent_info:
        result['parent'] = parent_info
    
    # Parse children relationships (if any exist in older files)
    children_section = re.search(r'Children:\s*\n(.*?)(?:Parent:|$)', links_content, re.DOTALL)
    if children_section:
        children_lines = children_section.group(1).strip().split('\n')
        for line in children_lines:
            child_match = re.match(r'-\s*\[\[(.*?)\]\]\s*(.+?)\s*\(this node\)', line)
            if child_match:
                child_filename = child_match.group(1).strip()
                relationship_type = child_match.group(2).strip()
                result['children'].append({
                    'child_filename': child_filename,
                    'relationship_type': relationship_type.replace('_', ' ')
                })
    
    return result