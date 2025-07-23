import logging
import re
from datetime import datetime
from typing import Dict, List, Optional
import difflib
from .tree_to_markdown import generate_filename_from_keywords, TreeToMarkdownConverter
from .utils import extract_summary

def extract_title_from_md(node_content):
    title_match = re.search(r'#+(.*)', node_content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "Untitled"
    title = title.lower()
    return title

class Node:
    def __init__(self, name : str, node_id: int, content: str, summary: str = "", parent_id: int = None):
        self.transcript_history = ""
        self.id: int = node_id
        self.content: str = content
        self.parent_id: int | None = parent_id
        self.children: List[int] = []
        self.relationships: Dict[int, str] = {}
        self.created_at: datetime = datetime.now()
        self.modified_at: datetime = datetime.now()
        self.title = name
        self.filename: str = str(node_id) + "_" + generate_filename_from_keywords(self.title)
        self.summary: str = summary
        self.num_appends: int = 0



class DecisionTree:
    def __init__(self, output_dir: Optional[str] = None):
        self.tree: Dict[int, Node] = {}
        self.next_node_id: int = 1
        self.output_dir = output_dir or "markdownTreeVaultDefault"
        self._markdown_converter: Optional[TreeToMarkdownConverter] = None
    
    @property
    def markdown_converter(self) -> TreeToMarkdownConverter:
        """Lazy initialization of markdown converter"""
        if self._markdown_converter is None:
            self._markdown_converter = TreeToMarkdownConverter(self.tree)
        return self._markdown_converter
    
    def _write_markdown_for_nodes(self, node_ids: List[int]) -> None:
        """Write markdown files for the specified nodes"""
        if node_ids:
            try:
                self.markdown_converter.convert_node(
                    output_dir=self.output_dir,
                    nodes_to_update=set(node_ids)
                )
                logging.info(f"Wrote markdown for nodes: {node_ids}")
            except Exception as e:
                logging.error(f"Failed to write markdown for nodes {node_ids}: {e}")

    def create_new_node(self, name: str, parent_node_id: int | None, content: str, summary : str, relationship_to_parent: str = "child of") -> int:
        if parent_node_id is not None and parent_node_id not in self.tree:
            logging.error(f"Warning: Trying to create a node with non-existent parent ID: {parent_node_id}")
            parent_node_id = None

        # Check if a similar node already exists as a child of this parent
        # todo, temp remove since unnec complexity for now.
        # existing_child_id = self._find_similar_child(name, parent_node_id)
        # if existing_child_id is not None:
        #     logging.info(f"Found existing similar child node '{self.tree[existing_child_id].title}' (ID: {existing_child_id}) under parent {parent_node_id}. Returning existing node instead of creating duplicate.")
        #     return existing_child_id

        # Only get and increment node_id after validation passes
        new_node_id = self.next_node_id
        new_node = Node(name, new_node_id, content, summary, parent_id=parent_node_id)
        if parent_node_id is not None:
            new_node.relationships[parent_node_id] = relationship_to_parent
        
        # Only increment after we successfully create the node
        self.tree[new_node_id] = new_node
        if parent_node_id is not None:
            self.tree[parent_node_id].children.append(new_node_id)

        self.tree[new_node_id].summary = summary if summary else extract_summary(content)
        
        # Increment AFTER successful creation
        self.next_node_id += 1
        
        # Write markdown for the new node and its parent (if exists)
        nodes_to_update = [new_node_id]
        if parent_node_id is not None:
            nodes_to_update.append(parent_node_id)
        self._write_markdown_for_nodes(nodes_to_update)

        return new_node_id
    
    def update_node(self, node_id: int, content: str, summary: str) -> None:
        """
        Replaces a node's content and summary completely.
        
        Args:
            node_id: The ID of the node to update
            content: The new content to replace existing content
            summary: The new summary to replace existing summary
            
        Raises:
            KeyError: If the node_id doesn't exist in the tree
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        node = self.tree[node_id]
        node.content = content
        node.summary = summary
        node.modified_at = datetime.now()
        
        # Write markdown for the updated node
        self._write_markdown_for_nodes([node_id])
    
    def append_node_content(self, node_id: int, new_content: str, transcript: str = "") -> None:
        """
        Appends content to an existing node and automatically writes markdown.
        
        Args:
            node_id: The ID of the node to append to
            new_content: The content to append
            transcript: Optional transcript history
            
        Raises:
            KeyError: If the node_id doesn't exist in the tree
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        node = self.tree[node_id]
        node.content += "\n" + new_content
        node.transcript_history += transcript + "... "
        node.modified_at = datetime.now()
        node.num_appends += 1
        
        # Write markdown for the updated node
        self._write_markdown_for_nodes([node_id])

    def find_node_by_name(self, name: str, similarity_threshold: float = 0.8) -> Optional[int]:
        """
        Find a node by its name using fuzzy matching.
        
        Args:
            name: The name to search for
            similarity_threshold: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            Node ID if found, None otherwise
        """
        if not name or not self.tree:
            return None
            
        # First try exact match (case-insensitive)
        for node_id, node in self.tree.items():
            if node.title.lower() == name.lower():
                return node_id
        
        # If no exact match, try fuzzy matching
        node_names = []
        node_ids = []
        for node_id, node in self.tree.items():
            node_names.append(node.title.lower())
            node_ids.append(node_id)
        
        # Find closest match
        closest_matches = difflib.get_close_matches(
            name.lower(), 
            node_names, 
            n=1, 
            cutoff=similarity_threshold
        )
        
        if closest_matches:
            # Find the ID of the matching node
            matched_name = closest_matches[0]
            for i, node_name in enumerate(node_names):
                if node_name == matched_name:
                    logging.info(f"Found fuzzy match: '{name}' matched to '{self.tree[node_ids[i]].title}' (ID: {node_ids[i]})")
                    return node_ids[i]
                    
        return None
    
    def _find_similar_child(self, name: str, parent_node_id: int | None, similarity_threshold: float = 0.8) -> Optional[int]:
        """
        Check if a similar node already exists as a child of the given parent.
        
        Args:
            name: The name to check for similarity
            parent_node_id: The parent node ID to check children of
            similarity_threshold: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            Node ID of similar child if found, None otherwise
        """
        if parent_node_id is None or parent_node_id not in self.tree:
            return None
            
        parent_node = self.tree[parent_node_id]
        if not parent_node.children:
            return None
            
        # Get names of all children
        child_names = []
        child_ids = []
        for child_id in parent_node.children:
            if child_id in self.tree:
                child_names.append(self.tree[child_id].title.lower())
                child_ids.append(child_id)
        
        # Find closest match among children
        closest_matches = difflib.get_close_matches(
            name.lower(), 
            child_names, 
            n=1, 
            cutoff=similarity_threshold
        )
        
        if closest_matches:
            # Find the ID of the matching child
            matched_name = closest_matches[0]
            for i, child_name in enumerate(child_names):
                if child_name == matched_name:
                    return child_ids[i]
                    
        return None

    def get_recent_nodes(self, num_nodes=10):
        """Returns a list of IDs of the most recently modified nodes."""
        sorted_nodes = sorted(self.tree.keys(), key=lambda k: self.tree[k].modified_at, reverse=True)
        return sorted_nodes[:num_nodes]
    
    def get_nodes_by_branching_factor(self, limit: Optional[int] = None) -> List[int]:
        """
        Get node IDs sorted by number of children (descending)
        
        Args:
            limit: Optional limit on number of nodes to return
            
        Returns:
            List of node IDs ordered by child count (descending)
        """
        # Create list of (node_id, child_count) tuples
        nodes_with_child_count = []
        for node_id, node in self.tree.items():
            child_count = len(node.children)
            nodes_with_child_count.append((node_id, child_count))
        
        # Sort by child count (descending)
        nodes_with_child_count.sort(key=lambda x: x[1], reverse=True)
        
        # Extract just the node IDs
        result = [node_id for node_id, _ in nodes_with_child_count]
        
        # Apply limit if specified
        if limit is not None:
            result = result[:limit]
        
        return result

    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        # assumes tree invariant
        for parent_id, node in self.tree.items():
            if node_id in node.children:
                return parent_id
        return None


    def get_neighbors(self, node_id: int) -> List[Dict]:
        """
        Returns immediate neighbors (parent, siblings, children) with summaries.
        
        Args:
            node_id: The ID of the node to get neighbors for
            
        Returns:
            List of dictionaries with structure:
            {"id": int, "name": str, "summary": str, "relationship": str}
            Where relationship is "parent", "sibling", or "child"
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        neighbors = []
        node = self.tree[node_id]
        
        # Get parent
        if node.parent_id is not None and node.parent_id in self.tree:
            parent_node = self.tree[node.parent_id]
            neighbors.append({
                "id": node.parent_id,
                "name": parent_node.title,
                "summary": parent_node.summary,
                "relationship": "parent"
            })
            
            # Get siblings (other children of the same parent)
            for sibling_id in parent_node.children:
                if sibling_id != node_id and sibling_id in self.tree:
                    sibling_node = self.tree[sibling_id]
                    neighbors.append({
                        "id": sibling_id,
                        "name": sibling_node.title,
                        "summary": sibling_node.summary,
                        "relationship": "sibling"
                    })
        
        # Get children
        for child_id in node.children:
            if child_id in self.tree:
                child_node = self.tree[child_id]
                neighbors.append({
                    "id": child_id,
                    "name": child_node.title,
                    "summary": child_node.summary,
                    "relationship": "child"
                })
        
        return neighbors

