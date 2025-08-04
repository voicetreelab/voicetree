"""
ColorWriter - Writes theme colors back to markdown files after theme identification.

This component takes theme identification results and updates the original markdown files
with color metadata in their YAML frontmatter, completing the theme coloring pipeline.
"""

import os
import hashlib
import re
from typing import Dict, List, Any
import yaml
import logging


# Predefined color palette for consistent theming
COLOR_PALETTE = [
    "red", "blue", "green", "orange", "purple", "cyan", "yellow", "pink",
    "brown", "gray", "lime", "teal", "indigo", "violet", "coral", "navy"
]


def write_theme_colors_to_markdown(theme_results: Dict[str, Any], input_forest_path: str) -> Dict[str, str]:
    """
    Write theme colors back to markdown files based on theme identification results.
    
    Args:
        theme_results: Output from ThemeIdentificationWorkflow.identify_themes()
        input_forest_path: Path to the input_forest directory containing markdown files
        
    Returns:
        Dict mapping node_id to assigned color for verification
        
    Raises:
        ValueError: If input_forest_path doesn't exist
        RuntimeError: If markdown file operations fail
    """
    if not os.path.exists(input_forest_path):
        raise ValueError(f"Input forest path does not exist: {input_forest_path}")
    
    # Extract themes from results
    identified_themes = theme_results.get("identified_themes", {})
    
    # Create theme name to color mapping
    theme_to_color = _assign_colors_to_themes(list(identified_themes.keys()))
    
    # Create node_id to color mapping
    node_color_assignments = {}
    for theme_name, theme_data in identified_themes.items():
        color = theme_to_color[theme_name]
        for node_id in theme_data["node_ids"]:
            node_color_assignments[node_id] = color
    
    # Update markdown files
    _update_markdown_files_with_colors(input_forest_path, node_color_assignments)
    
    logging.info(f"Successfully updated {len(node_color_assignments)} nodes with theme colors")
    return node_color_assignments


def _assign_colors_to_themes(theme_names: List[str]) -> Dict[str, str]:
    """
    Assign colors to themes deterministically using hash-based mapping.
    
    Args:
        theme_names: List of theme names to assign colors to
        
    Returns:
        Dict mapping theme_name to color
    """
    theme_to_color = {}
    
    for theme_name in theme_names:
        # Use hash for deterministic color assignment
        hash_value = hashlib.md5(theme_name.encode()).hexdigest()
        color_index = int(hash_value[:8], 16) % len(COLOR_PALETTE)
        theme_to_color[theme_name] = COLOR_PALETTE[color_index]
    
    return theme_to_color


def _update_markdown_files_with_colors(input_forest_path: str, node_color_assignments: Dict[int, str]) -> None:
    """
    Update markdown files with color assignments in YAML frontmatter.
    
    Args:
        input_forest_path: Path to directory containing markdown files
        node_color_assignments: Dict mapping node_id to color
    """
    markdown_files = [f for f in os.listdir(input_forest_path) if f.endswith('.md')]
    
    for filename in markdown_files:
        filepath = os.path.join(input_forest_path, filename)
        
        try:
            # Extract node_id from filename (assuming format: {node_id}_*.md)
            node_id = _extract_node_id_from_filename(filename)
            
            if node_id in node_color_assignments:
                color = node_color_assignments[node_id]
                _update_yaml_frontmatter_with_color(filepath, color)
                
        except Exception as e:
            logging.error(f"Failed to update {filename}: {e}")
            raise RuntimeError(f"Failed to update markdown file {filename}: {e}")


def _extract_node_id_from_filename(filename: str) -> int:
    """
    Extract node_id from markdown filename.
    
    Args:
        filename: Markdown filename (e.g., "1_project_overview.md")
        
    Returns:
        Node ID as integer
        
    Raises:
        ValueError: If node_id cannot be extracted
    """
    try:
        # Assuming format: {node_id}_*.md
        node_id_str = filename.split('_')[0]
        return int(node_id_str)
    except (IndexError, ValueError):
        raise ValueError(f"Cannot extract node_id from filename: {filename}")


def _update_yaml_frontmatter_with_color(filepath: str, color: str) -> None:
    """
    Update YAML frontmatter in markdown file to include color.
    
    Args:
        filepath: Path to markdown file
        color: Color to assign
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split content into frontmatter and body
    if content.startswith('---\n'):
        parts = content.split('---\n', 2)
        if len(parts) >= 3:
            frontmatter_text = parts[1]
            body = parts[2]
        else:
            # No closing ---
            frontmatter_text = ""
            body = content
    else:
        # No frontmatter
        frontmatter_text = ""
        body = content
    
    # Parse existing frontmatter
    if frontmatter_text.strip():
        try:
            frontmatter = yaml.safe_load(frontmatter_text)
        except yaml.YAMLError:
            frontmatter = {}
    else:
        frontmatter = {}
    
    # Update color
    frontmatter['color'] = color
    
    # Remove title key if it exists for better color visibility
    if 'title' in frontmatter:
        del frontmatter['title']
    
    # Rebuild file content
    new_frontmatter = yaml.dump(frontmatter, default_flow_style=False)
    new_content = f"---\n{new_frontmatter}---\n{body}"
    
    # Write back to file
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)