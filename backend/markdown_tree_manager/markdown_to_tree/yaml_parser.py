"""
YAML frontmatter parsing utilities.

This module handles extraction and parsing of YAML frontmatter from markdown files.
"""

import re
from typing import Dict
from typing import Optional
from typing import Tuple

import yaml


def extract_frontmatter(content: str) -> Tuple[Optional[Dict], str]:
    """
    Extract YAML frontmatter from markdown content.
    
    Args:
        content: Full markdown content
        
    Returns:
        Tuple of (metadata dict or None, content after frontmatter)
    """
    frontmatter_match = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    if not frontmatter_match:
        return None, content
    
    try:
        metadata = yaml.safe_load(frontmatter_match.group(1))
        content_after_frontmatter = content[frontmatter_match.end():]
        return metadata, content_after_frontmatter
    except yaml.YAMLError:
        return None, content


def extract_tags(content: str) -> Tuple[list, str]:
    """
    Extract hashtags from the first line of content if present.
    
    Args:
        content: Markdown content
        
    Returns:
        Tuple of (list of tags, content with tags line removed if found)
    """
    lines = content.split('\n')
    if lines and lines[0].strip().startswith('#') and not lines[0].strip().startswith('##'):
        # Check if this looks like hashtags (not a markdown heading)
        tag_line = lines[0].strip()
        # Look for hashtag pattern
        if re.match(r'^(#\w+\s*)+$', tag_line):
            tags = re.findall(r'#(\w+)', tag_line)
            # Remove the tag line from content
            remaining_content = '\n'.join(lines[1:])
            return tags, remaining_content
    return [], content