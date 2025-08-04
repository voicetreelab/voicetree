import os
import re
import yaml
import logging
from typing import Dict, Optional, List, Tuple
from datetime import datetime
from pathlib import Path

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


class MarkdownToTreeConverter:
    """Converts markdown files back to tree data structure"""
    
    def __init__(self):
        self.tree_data: Dict[int, Node] = {}
        self.filename_to_node_id: Dict[str, int] = {}
    
    def load_tree_from_markdown(self, markdown_dir: str) -> Dict[int, Node]:
        """
        Main entry point to load a tree from markdown files
        
        Args:
            markdown_dir: Directory containing markdown files
            
        Returns:
            Dictionary mapping node_id to Node objects
        """
        logging.info(f"Loading tree from markdown directory: {markdown_dir}")
        
        if not os.path.exists(markdown_dir):
            raise ValueError(f"Markdown directory does not exist: {markdown_dir}")
        
        # First pass: Load all nodes and build filename mapping
        markdown_files = [f for f in os.listdir(markdown_dir) if f.endswith('.md')]
        
        for filename in markdown_files:
            filepath = os.path.join(markdown_dir, filename)
            try:
                node = self._parse_markdown_file(filepath, filename)
                if node:
                    self.tree_data[node.id] = node
                    self.filename_to_node_id[filename] = node.id
            except Exception as e:
                logging.error(f"Error parsing file {filename}: {e}")
        
        # Second pass: Resolve relationships
        for filename in markdown_files:
            filepath = os.path.join(markdown_dir, filename)
            try:
                self._parse_relationships(filepath, filename)
            except Exception as e:
                logging.error(f"Error parsing relationships in {filename}: {e}")
        
        logging.info(f"Loaded {len(self.tree_data)} nodes from markdown")
        return self.tree_data
    
    def _parse_markdown_file(self, filepath: str, filename: str) -> Optional[Node]:
        """
        Parse a single markdown file to extract node data
        
        Args:
            filepath: Full path to the markdown file
            filename: Name of the file
            
        Returns:
            Node object or None if parsing fails
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract tags from the first line if they exist
        tags = []
        lines = content.split('\n')
        if lines and lines[0].strip().startswith('#'):
            # Extract hashtags from first line
            tag_line = lines[0].strip()
            tags = re.findall(r'#(\w+)', tag_line)
            # Remove the tag line from content
            content = '\n'.join(lines[1:])
        
        # Extract YAML frontmatter
        frontmatter_match = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
        if not frontmatter_match:
            logging.warning(f"No frontmatter found in {filename}")
            return None
        
        try:
            metadata = yaml.safe_load(frontmatter_match.group(1))
        except yaml.YAMLError as e:
            logging.error(f"Failed to parse YAML in {filename}: {e}")
            return None
        
        # Extract required fields from metadata
        node_id = metadata.get('node_id')
        if node_id is None:
            logging.error(f"No node_id found in {filename}")
            return None
        
        title = metadata.get('title', 'Untitled')
        created_at = metadata.get('created_at', datetime.now().isoformat())
        modified_at = metadata.get('modified_at', datetime.now().isoformat())
        
        # Convert ISO format strings to datetime objects
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        if isinstance(modified_at, str):
            modified_at = datetime.fromisoformat(modified_at)
        
        # Extract content after frontmatter
        markdown_content = content[frontmatter_match.end():]
        
        # Extract summary and main content
        summary, main_content = self._extract_summary_and_content(markdown_content)
        
        # Create Node object
        node = Node(
            name=title,
            node_id=node_id,
            content=main_content,
            summary=summary
        )
        
        # Set datetime fields
        node.created_at = created_at
        node.modified_at = modified_at
        node.filename = filename
        
        # Set tags if they were extracted
        if tags:
            node.tags = tags
        
        # Extract any additional metadata fields
        if 'color' in metadata:
            node.color = metadata['color']
        
        return node
    
    def _extract_summary_and_content(self, markdown_content: str) -> Tuple[str, str]:
        """
        Extract summary and main content from markdown
        
        Args:
            markdown_content: Markdown content after frontmatter
            
        Returns:
            Tuple of (summary, content)
        """
        lines = markdown_content.strip().split('\n')
        summary = ""
        content_lines = []
        found_summary = False
        
        for i, line in enumerate(lines):
            # Check if line is a summary (starts with ###)
            if line.strip().startswith('###') and not found_summary:
                summary = line.strip().lstrip('#').strip()
                found_summary = True
                # Skip this line - don't add summary line to content
                continue
            elif line.strip() == '-----------------':
                # Stop before the links section
                break
            elif found_summary:
                content_lines.append(line)
            elif not found_summary:
                # If no summary found yet, these lines are part of content
                content_lines.append(line)
        
        # Join content lines and clean up
        content = '\n'.join(content_lines).strip()
        
        # Don't automatically create summary from first line
        # Only return summary if explicitly found with ### prefix
        
        return summary, content
    
    def _parse_relationships(self, filepath: str, filename: str) -> None:
        """
        Parse relationships from the Links section of markdown file
        
        Args:
            filepath: Full path to the markdown file
            filename: Name of the file
        """
        if filename not in self.filename_to_node_id:
            return
        
        node_id = self.filename_to_node_id[filename]
        node = self.tree_data[node_id]
        
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find the Links section
        links_match = re.search(r'_Links:_\s*\n(.*?)(?:\n\n|$)', content, re.DOTALL)
        if not links_match:
            return
        
        links_content = links_match.group(1)
        
        # Parse parent relationship
        parent_match = re.search(r'Parent:\s*\n.*?-\s*(.+?)\s*\[\[(.*?)\]\]', links_content)
        if parent_match:
            relationship_type = parent_match.group(1).strip()
            parent_filename = parent_match.group(2).strip()
            
            if parent_filename in self.filename_to_node_id:
                parent_id = self.filename_to_node_id[parent_filename]
                node.parent_id = parent_id
                node.relationships[parent_id] = relationship_type.replace('_', ' ')
                
                # Add this node as child to parent
                if parent_id in self.tree_data:
                    parent_node = self.tree_data[parent_id]
                    if node_id not in parent_node.children:
                        parent_node.children.append(node_id)
        
        # Parse children relationships (if any exist in older files)
        children_section = re.search(r'Children:\s*\n(.*?)(?:Parent:|$)', links_content, re.DOTALL)
        if children_section:
            children_lines = children_section.group(1).strip().split('\n')
            for line in children_lines:
                child_match = re.match(r'-\s*\[\[(.*?)\]\]\s*(.+?)\s*\(this node\)', line)
                if child_match:
                    child_filename = child_match.group(1).strip()
                    relationship_type = child_match.group(2).strip()
                    
                    if child_filename in self.filename_to_node_id:
                        child_id = self.filename_to_node_id[child_filename]
                        if child_id not in node.children:
                            node.children.append(child_id)
                        
                        # Set the relationship from child's perspective
                        if child_id in self.tree_data:
                            child_node = self.tree_data[child_id]
                            child_node.parent_id = node_id
                            child_node.relationships[node_id] = relationship_type.replace('_', ' ')


def load_markdown_tree(markdown_dir: str) -> Dict[int, Node]:
    """
    Convenience function to load a tree from markdown files
    
    Args:
        markdown_dir: Directory containing markdown files
        
    Returns:
        Dictionary mapping node_id to Node objects
    """
    converter = MarkdownToTreeConverter()
    return converter.load_tree_from_markdown(markdown_dir)


def load_markdown_repository_for_themes(input_forest_path: str) -> Dict[int, Node]:
    """
    Load markdown repository specifically for theme identification by stripping color metadata
    
    This function wraps the existing load_markdown_tree functionality and ensures all
    color metadata is removed from nodes to prevent bias in theme identification.
    
    Args:
        input_forest_path: Path to input_forest directory containing markdown files
        
    Returns:
        Dictionary mapping node_id to Node objects with color metadata stripped
    """
    # Load the tree using existing functionality
    tree_data = load_markdown_tree(input_forest_path)
    
    # Strip color metadata from all nodes
    for node in tree_data.values():
        if hasattr(node, 'color'):
            node.color = None
    
    return tree_data