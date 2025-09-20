import logging
import os
from pathlib import Path
from typing import Dict
from typing import Optional

from backend.markdown_tree_manager.markdown_to_tree.comprehensive_parser import (
    parse_markdown_file_complete,
)
from backend.markdown_tree_manager.markdown_to_tree.comprehensive_parser import (
    parse_relationships_from_links,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node


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
        Parse a single markdown file to extract node data.
        This is now a thin wrapper around the comprehensive parser.
        
        Args:
            filepath: Full path to the markdown file
            filename: Name of the file
            
        Returns:
            Node object or None if parsing fails
        """
        # Use the comprehensive parser from the module
        parsed_data = parse_markdown_file_complete(Path(filepath))
        if not parsed_data:
            logging.warning(f"Could not parse file {filename}")
            return None
        
        # Create Node object from parsed data
        node = Node(
            name=parsed_data['title'],
            node_id=parsed_data['node_id'],
            content=parsed_data['content'],
            summary=parsed_data['summary']
        )
        
        # Set all attributes from parsed data
        node.created_at = parsed_data['created_at']
        node.modified_at = parsed_data['modified_at']
        node.filename = filename
        
        if parsed_data['tags']:
            node.tags = parsed_data['tags']
        
        if parsed_data['color']:
            node.color = parsed_data['color']
        
        return node
    
    
    def _parse_relationships(self, filepath: str, filename: str) -> None:
        """
        Parse relationships from the Links section of markdown file.
        This is now a thin wrapper around the module's relationship parser.
        
        Args:
            filepath: Full path to the markdown file
            filename: Name of the file
        """
        if filename not in self.filename_to_node_id:
            return
        
        node_id = self.filename_to_node_id[filename]
        node = self.tree_data[node_id]
        
        # Read the file content
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Use the module's relationship parser
        relationships = parse_relationships_from_links(content)
        
        # Process parent relationship
        if relationships['parent']:
            parent_filename = relationships['parent']['parent_filename']
            relationship_type = relationships['parent']['relationship_type']
            
            if parent_filename in self.filename_to_node_id:
                parent_id = self.filename_to_node_id[parent_filename]
                node.parent_id = parent_id
                node.relationships[parent_id] = relationship_type
                
                # Add this node as child to parent
                if parent_id in self.tree_data:
                    parent_node = self.tree_data[parent_id]
                    if node_id not in parent_node.children:
                        parent_node.children.append(node_id)
        
        # Process children relationships (if any)
        for child_info in relationships['children']:
            child_filename = child_info['child_filename']
            relationship_type = child_info['relationship_type']
            
            if child_filename in self.filename_to_node_id:
                child_id = self.filename_to_node_id[child_filename]
                if child_id not in node.children:
                    node.children.append(child_id)
                
                # Set the relationship from child's perspective
                if child_id in self.tree_data:
                    child_node = self.tree_data[child_id]
                    child_node.parent_id = node_id
                    child_node.relationships[node_id] = relationship_type


def load_markdown_tree(markdown_dir: str) -> MarkdownTree:
    """
    Convenience function to load a tree from markdown files

    Args:
        markdown_dir: Directory containing markdown files

    Returns:
        MarkdownTree object with loaded nodes
    """
    converter = MarkdownToTreeConverter()
    tree_dict = converter.load_tree_from_markdown(markdown_dir)

    # Create MarkdownTree object with the loaded data
    markdown_tree = MarkdownTree(output_dir=markdown_dir)
    markdown_tree.tree = tree_dict

    # Set the next_node_id based on the highest existing ID
    if tree_dict:
        markdown_tree.next_node_id = max(tree_dict.keys()) + 1

    return markdown_tree


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