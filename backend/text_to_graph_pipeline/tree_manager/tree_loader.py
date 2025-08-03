"""
TreeLoader - Loads and parses markdown tree structures from filesystem
"""

import os
import re
import yaml
from typing import Dict, Any, List, Optional
from pathlib import Path

from ..agentic_workflows.models import TreeNode, TreeData


class TreeLoader:
    """
    Loads markdown forest data and constructs tree structures.
    
    This handles file I/O operations and converts raw markdown files into structured 
    tree data that other components can process.
    """
    
    def load_forest(self, forest_path: str) -> Dict[str, Any]:
        """
        Load all trees from a forest directory.
        
        Args:
            forest_path: Path to directory containing tree subdirectories
            
        Returns:
            Dictionary with 'trees' key containing list of TreeData objects
        """
        forest_path = Path(forest_path)
        if not forest_path.exists():
            raise FileNotFoundError(f"Forest path does not exist: {forest_path}")
            
        trees = []
        
        # Find all tree directories (timestamped subdirectories)
        for tree_dir in forest_path.iterdir():
            if tree_dir.is_dir() and self._is_tree_directory(tree_dir.name):
                tree_data = self._load_single_tree(tree_dir)
                if tree_data:
                    trees.append(tree_data)
        
        return {"trees": trees}
    
    def load_single_tree(self, tree_path: str) -> Dict[str, Any]:
        """
        Load a single tree from a directory path.
        
        Args:
            tree_path: Path to tree directory
            
        Returns:
            Dictionary with single tree data
        """
        tree_dir = Path(tree_path)
        tree_data = self._load_single_tree(tree_dir)
        return {"trees": [tree_data] if tree_data else []}
    
    def _is_tree_directory(self, dirname: str) -> bool:
        """Check if directory name looks like a tree directory (timestamped)"""
        # Match patterns like "2025-08-02_20250802_150743"
        pattern = r'^\d{4}-\d{2}-\d{2}(_\d{8}_\d{6})?$'
        return bool(re.match(pattern, dirname))
    
    def _load_single_tree(self, tree_dir: Path) -> Optional[TreeData]:
        """Load a single tree from a directory"""
        if not tree_dir.exists() or not tree_dir.is_dir():
            return None
            
        nodes = []
        
        # Find all markdown files in the tree directory
        for md_file in tree_dir.glob("*.md"):
            node = self._parse_markdown_file(md_file)
            if node:
                nodes.append(node)
        
        if not nodes:
            return None
            
        return TreeData(
            tree_id=tree_dir.name,
            nodes=nodes
        )
    
    def _parse_markdown_file(self, file_path: Path) -> Optional[TreeNode]:
        """Parse a single markdown file into a TreeNode"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Split frontmatter and content
            parts = content.split('---', 2)
            if len(parts) < 3:
                # No frontmatter found
                return None
            
            # Parse YAML frontmatter
            try:
                frontmatter = yaml.safe_load(parts[1])
            except yaml.YAMLError:
                return None
            
            # Extract required fields
            node_id = frontmatter.get('node_id')
            title = frontmatter.get('title', file_path.stem)
            
            if not node_id:
                return None
            
            # Convert node_id to string if it's not already
            node_id = str(node_id)
            
            # Get markdown content (after frontmatter)
            markdown_content = parts[2].strip()
            
            # Extract links from markdown content
            links = self._extract_links(markdown_content)
            
            return TreeNode(
                node_id=node_id,
                title=title,
                content=markdown_content,
                links=links
            )
            
        except Exception as e:
            print(f"Error parsing {file_path}: {e}")
            return None
    
    def _extract_links(self, markdown_content: str) -> List[str]:
        """Extract markdown links from content"""
        # Find all markdown links [[filename]]
        link_pattern = r'\[\[([^\]]+)\]\]'
        matches = re.findall(link_pattern, markdown_content)
        
        # Clean up the matches
        links = []
        for match in matches:
            # Remove .md extension if present
            clean_link = match.replace('.md', '')
            links.append(clean_link)
        
        return links