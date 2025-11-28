"""
Comprehensive markdown file parser.

This module provides complete parsing of markdown files including
YAML frontmatter, tags, content, and relationships.
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Any
from typing import Optional
from typing import Union

from backend.types import (
    ParsedNode,
    ParsedNodeKeys,
    ParsedRelationships,
    ParentRelationship,
    RelationshipKeys,
)

from backend.markdown_tree_manager.markdown_to_tree.file_operations import (
    read_markdown_file,
)
from backend.markdown_tree_manager.markdown_to_tree.link_extraction import (
    extract_markdown_links,
)
from backend.markdown_tree_manager.markdown_to_tree.metadata_extraction import (
    extract_node_id,
)
from backend.markdown_tree_manager.markdown_to_tree.yaml_parser import (
    extract_frontmatter,
)
from backend.markdown_tree_manager.markdown_to_tree.yaml_parser import extract_tags


def parse_markdown_file_complete(filepath: Path) -> Optional[ParsedNode]:
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
    node_id: Union[int, str]
    if node_id_str:
        try:
            node_id = int(node_id_str)
        except ValueError:
            node_id = node_id_str
    else:
        node_id_from_meta = metadata.get('node_id')
        if node_id_from_meta is None:
            return None
        node_id = node_id_from_meta

    # Extract title, summary, and parse content
    # Title comes from first heading (#), summary from second heading (###)
    title, summary, main_content = extract_title_summary_and_content(content_after_frontmatter)

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
    parent_info = extract_parent_relationship(content) # DEPRECATED

    return {
        ParsedNodeKeys.NODE_ID: node_id,
        ParsedNodeKeys.TITLE: title,
        ParsedNodeKeys.SUMMARY: summary,
        ParsedNodeKeys.CONTENT: main_content,
        ParsedNodeKeys.TAGS: tags,
        ParsedNodeKeys.CREATED_AT: created_at,
        ParsedNodeKeys.MODIFIED_AT: modified_at,
        ParsedNodeKeys.COLOR: metadata.get('color'),
        ParsedNodeKeys.LINKS: links,
        ParsedNodeKeys.PARENT_INFO: parent_info,
        ParsedNodeKeys.FILENAME: filepath.name
    }


def extract_title_summary_and_content(markdown_content: str) -> tuple[str, str, str]:
    """
    Extract title, summary, and main content from markdown after frontmatter.

    Title is the first heading (# or any level).
    Summary is the first ### heading after the title.
    Content is everything else before the links section.

    Args:
        markdown_content: Markdown content after frontmatter

    Returns:
        Tuple of (title, summary, main_content)
    """
    lines = markdown_content.strip().split('\n')
    title = "Untitled"
    summary = ""
    content_lines = []
    found_title = False
    found_summary = False

    for line in lines:
        stripped = line.strip()
        # Check if line is a title (first heading of any level)
        if stripped.startswith('#') and not found_title:
            title = stripped.lstrip('#').strip()
            found_title = True
            # Skip the title line from content
            continue
        # Check if line is a summary (## or ### heading after title)
        elif stripped.startswith('##') and not found_summary:
            summary = stripped.lstrip('#').strip()
            found_summary = True
            # Skip the summary line from content
            continue
        elif stripped == '-----------------':
            # Stop before the links section
            break
        else:
            content_lines.append(line)

    # Join content lines
    content = '\n'.join(content_lines).strip()

    return title, summary, content


def extract_parent_relationship(content: str) -> Optional[ParentRelationship]:
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
            RelationshipKeys.PARENT_FILENAME: parent_filename,
            RelationshipKeys.RELATIONSHIP_TYPE: relationship_type.replace('_', ' ')
        }

    return None


def parse_relationships_from_links(content: str) -> ParsedRelationships:
    """
    Parse all relationships from the Links section by extracting wikilinks.

    Finds all [[filename]] wikilinks in the Links section. If a wikilink
    has a relationship type prefix (e.g., "- relationship_type [[...]]"),
    that relationship type is captured; otherwise, the relationship type
    is empty.

    Args:
        content: Full markdown content

    Returns:
        Dictionary with parent and children relationships
    """
    links_match = re.search(r'_Links:_\s*\n(.*)', content, re.DOTALL)
    if not links_match:
        return {RelationshipKeys.PARENT: None, RelationshipKeys.CHILDREN: []}

    links_content = links_match.group(1)
    result: ParsedRelationships = {RelationshipKeys.PARENT: None, RelationshipKeys.CHILDREN: []}

    # Find all wikilinks in the links section
    # Pattern: optionally "- relationship_type " followed by [[filename]]
    for line in links_content.split('\n'):
        # Try to match: - {relationship_type} [[{filename}]]
        match_with_rel = re.match(r'-\s*(.+?)\s*\[\[([^\]]+)\]\]', line)
        if match_with_rel:
            relationship_type = match_with_rel.group(1).strip().replace('_', ' ')
            filename = match_with_rel.group(2).strip()
            result[RelationshipKeys.CHILDREN].append({
                RelationshipKeys.CHILD_FILENAME: filename,
                RelationshipKeys.RELATIONSHIP_TYPE: relationship_type
            })
        else:
            # Try to match bare wikilinks: [[{filename}]]
            bare_links = re.findall(r'\[\[([^\]]+)\]\]', line)
            for filename in bare_links:
                result[RelationshipKeys.CHILDREN].append({
                    RelationshipKeys.CHILD_FILENAME: filename.strip(),
                    RelationshipKeys.RELATIONSHIP_TYPE: '' # todo, why do we no longer send relationship_type.replace('_', ' ') ???
                })

    return result
