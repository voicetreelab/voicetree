import os
import re
import hashlib
import yaml
from typing import Dict, Any, List, Optional

from .utils import insert_yaml_frontmatter


class NodeProcessor:
    """
    Processes classified subtree data and updates markdown files with color-coded metadata.
    
    This is the final stage of the subtree identification pipeline that takes classified
    subtrees and writes the metadata back to the original markdown files.
    """
    
    def process_classified_trees(self, classified_data: Dict[str, Any], base_path: str) -> None:
        """
        Process classified subtree data and update markdown files with subtree metadata.
        
        Args:
            classified_data: Dictionary containing classified trees with subtrees
            base_path: Base directory path containing the markdown files
        """
        if "classified_trees" not in classified_data:
            return
            
        for tree_data in classified_data["classified_trees"]:
            tree_id = tree_data.get("tree_id")
            subtrees = tree_data.get("subtrees", [])
            
            # Generate color palette for all subtrees in this tree
            subtree_ids = [subtree["subtree_id"] for subtree in subtrees]
            color_palette = self._generate_color_palette(subtree_ids)
            
            # Update files for each subtree
            for subtree in subtrees:
                subtree_id = subtree["subtree_id"]
                subtree_color = color_palette[subtree_id]
                subtree_theme = subtree["theme"]
                node_ids = subtree["nodes"]
                
                for node_id in node_ids:
                    self._update_node_file(
                        base_path, 
                        node_id, 
                        subtree_id, 
                        subtree_color, 
                        subtree_theme
                    )
    
    def _generate_color_palette(self, subtree_ids: List[str]) -> Dict[str, str]:
        """
        Generate a deterministic color palette for subtree IDs.
        
        Uses hash-based color generation to ensure the same subtree_id 
        always gets the same color.
        
        Args:
            subtree_ids: List of subtree identifiers
            
        Returns:
            Dictionary mapping subtree_id to hex color
        """
        colors = {}
        
        # Predefined color palette for better visual distinction
        base_colors = [
            "#FF6B6B",  # Red
            "#4ECDC4",  # Teal  
            "#45B7D1",  # Blue
            "#96CEB4",  # Green
            "#FECA57",  # Yellow
            "#FF9FF3",  # Pink
            "#74B9FF",  # Light Blue
            "#A29BFE",  # Purple
            "#FD79A8",  # Rose
            "#E17055"   # Orange
        ]
        
        for i, subtree_id in enumerate(subtree_ids):
            if i < len(base_colors):
                # Use predefined colors for first few subtrees
                colors[subtree_id] = base_colors[i]
            else:
                # Generate deterministic color from hash for additional subtrees
                colors[subtree_id] = self._hash_to_color(subtree_id)
                
        return colors
    
    def _hash_to_color(self, text: str) -> str:
        """
        Generate a deterministic hex color from text using hash.
        
        Args:
            text: Input text to hash
            
        Returns:
            Hex color string (e.g., "#FF6B6B")
        """
        # Create hash and take first 6 characters for RGB
        hash_obj = hashlib.md5(text.encode())
        hex_color = hash_obj.hexdigest()[:6]
        return f"#{hex_color.upper()}"
    
    def _update_node_file(self, base_path: str, node_id: str, subtree_id: str, 
                         subtree_color: str, subtree_theme: str) -> None:
        """
        Update a single markdown file with subtree metadata.
        
        Args:
            base_path: Directory containing markdown files
            node_id: Node identifier to find the correct file
            subtree_id: Subtree identifier  
            subtree_color: Hex color for the subtree
            subtree_theme: Theme description for the subtree
        """
        # Find the markdown file for this node
        file_path = self._find_node_file(base_path, node_id)
        if not file_path:
            return
            
        # Read existing content
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Parse and update YAML frontmatter
        updated_content = self._update_yaml_frontmatter(
            content, 
            subtree_id, 
            subtree_color, 
            subtree_theme
        )
        
        # Write updated content back
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(updated_content)
    
    def _find_node_file(self, base_path: str, node_id: str) -> Optional[str]:
        """
        Find the markdown file corresponding to a node ID.
        
        Looks for files that start with the node_id followed by underscore.
        
        Args:
            base_path: Directory to search in
            node_id: Node identifier
            
        Returns:
            Full path to the file, or None if not found
        """
        if not os.path.exists(base_path):
            return None
            
        for filename in os.listdir(base_path):
            if filename.endswith('.md') and filename.startswith(f"{node_id}_"):
                return os.path.join(base_path, filename)
                
        return None
    
    def _update_yaml_frontmatter(self, content: str, subtree_id: str, 
                               subtree_color: str, subtree_theme: str) -> str:
        """
        Update YAML frontmatter in markdown content with subtree metadata.
        
        Preserves existing frontmatter and adds subtree fields.
        
        Args:
            content: Original markdown content
            subtree_id: Subtree identifier
            subtree_color: Hex color for subtree
            subtree_theme: Theme description
            
        Returns:
            Updated markdown content with new frontmatter
        """
        # Extract existing YAML frontmatter
        existing_yaml = self._extract_yaml_frontmatter(content)
        
        # Add subtree metadata
        existing_yaml['subtree_color'] = subtree_color
        existing_yaml['subtree_id'] = subtree_id  
        existing_yaml['subtree_theme'] = subtree_theme
        
        # Remove old frontmatter and add updated version
        content_without_frontmatter = self._remove_frontmatter(content)
        new_frontmatter = insert_yaml_frontmatter(existing_yaml)
        
        return new_frontmatter + content_without_frontmatter
    
    def _extract_yaml_frontmatter(self, content: str) -> Dict[str, Any]:
        """
        Extract YAML frontmatter from markdown content.
        
        Args:
            content: Markdown content with YAML frontmatter
            
        Returns:
            Dictionary of frontmatter key-value pairs
        """
        lines = content.strip().split('\n')
        
        # Check if content starts with frontmatter
        if not lines or lines[0] != '---':
            return {}
            
        # Find end of frontmatter
        end_index = None
        for i, line in enumerate(lines[1:], 1):
            if line == '---':
                end_index = i
                break
                
        if end_index is None:
            return {}
            
        # Parse YAML content
        yaml_content = '\n'.join(lines[1:end_index])
        try:
            return yaml.safe_load(yaml_content) or {}
        except yaml.YAMLError:
            return {}
    
    def _remove_frontmatter(self, content: str) -> str:
        """
        Remove YAML frontmatter from markdown content.
        
        Args:
            content: Markdown content with frontmatter
            
        Returns:
            Content without frontmatter
        """
        lines = content.strip().split('\n')
        
        # Check if content starts with frontmatter  
        if not lines or lines[0] != '---':
            return content
            
        # Find end of frontmatter
        end_index = None
        for i, line in enumerate(lines[1:], 1):
            if line == '---':
                end_index = i
                break
                
        if end_index is None:
            return content
            
        # Return content after frontmatter
        remaining_lines = lines[end_index + 1:]
        return '\n'.join(remaining_lines)