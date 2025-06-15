"""
Unified Tree Storage for VoiceTree
Consolidates tree storage and management functionality
"""

import logging
import json
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict


@dataclass
class Node:
    """Unified Node data structure"""
    id: int
    name: str
    title: str  # Display title
    content: str
    summary: str
    parent_id: Optional[int]
    children: List[int]
    
    # Metadata
    created_at: datetime
    modified_at: datetime
    relationship: Optional[str] = None
    filename: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert node to dictionary for serialization"""
        return {
            **asdict(self),
            "created_at": self.created_at.isoformat(),
            "modified_at": self.modified_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Node":
        """Create node from dictionary"""
        data = data.copy()
        data["created_at"] = datetime.fromisoformat(data["created_at"])
        data["modified_at"] = datetime.fromisoformat(data["modified_at"])
        return cls(**data)


class TreeStorage:
    """
    Unified tree storage that handles all tree operations
    Replaces DecisionTree and related functionality
    """
    
    def __init__(self, state_file: Optional[str] = None):
        """
        Initialize tree storage
        
        Args:
            state_file: Optional path for persistent storage
        """
        self.state_file = Path(state_file) if state_file else None
        self.tree: Dict[int, Node] = {}
        self.next_node_id = 1
        
        # Statistics
        self.statistics = {
            "total_nodes_created": 0,
            "total_nodes_updated": 0,
            "total_nodes_deleted": 0,
            "last_save_time": None
        }
        
        # Initialize with root node
        self._create_root_node()
        
        # Load existing state if available
        if self.state_file and self.state_file.exists():
            self.load_state()
        
        logging.info(f"TreeStorage initialized with {len(self.tree)} nodes")
    
    def _create_root_node(self) -> None:
        """Create the root node"""
        now = datetime.now()
        root = Node(
            id=0,
            name="Root",
            title="Root",
            content="Root node of the VoiceTree knowledge graph",
            summary="Root node containing all knowledge",
            parent_id=None,
            children=[],
            created_at=now,
            modified_at=now,
            relationship=None,
            filename="Root.md"
        )
        self.tree[0] = root
    
    def create_node(
        self,
        name: str,
        content: str,
        summary: str,
        parent_id: int = 0,
        relationship: str = "child of"
    ) -> int:
        """
        Create a new node in the tree
        
        Args:
            name: Node name/title
            content: Node content
            summary: Node summary  
            parent_id: ID of parent node
            relationship: Relationship to parent
            
        Returns:
            ID of created node
        """
        node_id = self.next_node_id
        self.next_node_id += 1
        
        now = datetime.now()
        
        # Generate filename
        safe_name = self._safe_filename(name)
        filename = f"{safe_name}.md"
        
        # Create node
        node = Node(
            id=node_id,
            name=name,
            title=name,
            content=content,
            summary=summary,
            parent_id=parent_id,
            children=[],
            created_at=now,
            modified_at=now,
            relationship=relationship,
            filename=filename
        )
        
        # Add to tree
        self.tree[node_id] = node
        
        # Update parent's children list
        if parent_id in self.tree:
            self.tree[parent_id].children.append(node_id)
            self.tree[parent_id].modified_at = now
        
        # Update statistics
        self.statistics["total_nodes_created"] += 1
        
        logging.info(f"Created node {node_id}: '{name}' (parent: {parent_id})")
        return node_id
    
    def append_to_node(
        self,
        node_id: int,
        content: str,
        summary: str
    ) -> bool:
        """
        Append content to an existing node
        
        Args:
            node_id: ID of node to update
            content: Content to append
            summary: Updated summary
            
        Returns:
            True if successful, False otherwise
        """
        if node_id not in self.tree:
            logging.error(f"Cannot append - node {node_id} not found")
            return False
        
        node = self.tree[node_id]
        
        # Append content
        if node.content:
            node.content += "\n\n" + content
        else:
            node.content = content
        
        # Update summary
        node.summary = summary
        node.modified_at = datetime.now()
        
        # Update statistics
        self.statistics["total_nodes_updated"] += 1
        
        logging.info(f"Appended to node {node_id}: '{node.title}'")
        return True
    
    def find_node_by_name(self, name: str) -> Optional[int]:
        """
        Find a node by name
        
        Args:
            name: Node name to search for
            
        Returns:
            Node ID if found, None otherwise
        """
        for node_id, node in self.tree.items():
            if node.name == name or node.title == name:
                return node_id
        return None
    
    def get_node(self, node_id: int) -> Optional[Node]:
        """
        Get a node by ID
        
        Args:
            node_id: Node ID
            
        Returns:
            Node if found, None otherwise
        """
        return self.tree.get(node_id)
    
    def get_all_nodes(self) -> Dict[int, Node]:
        """Get all nodes in the tree"""
        return self.tree.copy()
    
    def get_children(self, node_id: int) -> List[Node]:
        """
        Get all children of a node
        
        Args:
            node_id: Parent node ID
            
        Returns:
            List of child nodes
        """
        if node_id not in self.tree:
            return []
        
        children = []
        for child_id in self.tree[node_id].children:
            if child_id in self.tree:
                children.append(self.tree[child_id])
        
        return children
    
    def get_recent_nodes(self, num_nodes: int = 10) -> List[int]:
        """
        Get recently created/modified nodes
        
        Args:
            num_nodes: Number of recent nodes to return
            
        Returns:
            List of node IDs, most recent first
        """
        # Sort by modified time, most recent first
        sorted_nodes = sorted(
            self.tree.items(),
            key=lambda x: x[1].modified_at,
            reverse=True
        )
        
        # Return node IDs, excluding root
        recent_ids = []
        for node_id, node in sorted_nodes:
            if node_id != 0:  # Skip root
                recent_ids.append(node_id)
                if len(recent_ids) >= num_nodes:
                    break
        
        return recent_ids
    
    def get_tree_stats(self) -> Dict[str, Any]:
        """Get statistics about the tree structure"""
        total_nodes = len(self.tree)
        root_children = len(self.tree[0].children) if 0 in self.tree else 0
        
        # Calculate depth statistics
        max_depth = 0
        depth_counts = {}
        
        def calculate_depth(node_id: int, depth: int = 0) -> None:
            nonlocal max_depth
            max_depth = max(max_depth, depth)
            depth_counts[depth] = depth_counts.get(depth, 0) + 1
            
            if node_id in self.tree:
                for child_id in self.tree[node_id].children:
                    calculate_depth(child_id, depth + 1)
        
        calculate_depth(0)
        
        return {
            "total_nodes": total_nodes,
            "root_children": root_children,
            "max_depth": max_depth,
            "nodes_by_depth": depth_counts,
            "average_children_per_node": sum(len(node.children) for node in self.tree.values()) / total_nodes if total_nodes > 0 else 0
        }
    
    def save_state(self) -> None:
        """Save tree state to disk"""
        if not self.state_file:
            return
        
        try:
            state_data = {
                "tree": {str(node_id): node.to_dict() for node_id, node in self.tree.items()},
                "next_node_id": self.next_node_id,
                "statistics": self.statistics,
                "saved_at": datetime.now().isoformat()
            }
            
            with open(self.state_file, 'w') as f:
                json.dump(state_data, f, indent=2)
            
            self.statistics["last_save_time"] = datetime.now().isoformat()
            logging.info(f"Tree state saved to {self.state_file}")
            
        except Exception as e:
            logging.error(f"Failed to save tree state: {e}")
    
    def load_state(self) -> None:
        """Load tree state from disk"""
        if not self.state_file or not self.state_file.exists():
            return
        
        try:
            with open(self.state_file, 'r') as f:
                state_data = json.load(f)
            
            # Load tree
            self.tree = {}
            for node_id_str, node_data in state_data.get("tree", {}).items():
                node_id = int(node_id_str)
                self.tree[node_id] = Node.from_dict(node_data)
            
            # Load metadata
            self.next_node_id = state_data.get("next_node_id", max(self.tree.keys()) + 1 if self.tree else 1)
            self.statistics = state_data.get("statistics", self.statistics)
            
            logging.info(f"Tree state loaded from {self.state_file}: {len(self.tree)} nodes")
            
        except Exception as e:
            logging.error(f"Failed to load tree state: {e}")
    
    def clear_tree(self) -> None:
        """Clear all nodes except root"""
        self.tree.clear()
        self._create_root_node()
        self.next_node_id = 1
        
        # Reset statistics
        self.statistics = {
            "total_nodes_created": 0,
            "total_nodes_updated": 0,
            "total_nodes_deleted": 0,
            "last_save_time": None
        }
        
        logging.info("Tree cleared, only root node remains")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive storage statistics"""
        tree_stats = self.get_tree_stats()
        
        return {
            **self.statistics,
            **tree_stats,
            "next_node_id": self.next_node_id,
            "state_file": str(self.state_file) if self.state_file else None
        }
    
    def reset_statistics(self) -> None:
        """Reset storage statistics"""
        self.statistics = {
            "total_nodes_created": 0,
            "total_nodes_updated": 0,
            "total_nodes_deleted": 0,
            "last_save_time": None
        }
    
    def _safe_filename(self, name: str) -> str:
        """
        Convert a node name to a safe filename
        
        Args:
            name: Node name
            
        Returns:
            Safe filename string
        """
        import re
        
        # Replace unsafe characters
        safe = re.sub(r'[<>:"/\\|?*]', '_', name)
        
        # Limit length
        if len(safe) > 50:
            safe = safe[:50]
        
        # Ensure it's not empty
        if not safe or safe.isspace():
            safe = f"Node_{self.next_node_id}"
        
        return safe 