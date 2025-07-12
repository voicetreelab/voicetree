import logging
import re
from datetime import datetime
from typing import Dict, List, Optional
import difflib
from .tree_to_markdown import generate_filename_from_keywords
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

    def append_content(self, new_content: str, summary:str, transcript: str = ""):
        self.content += "\n" + new_content
        self.summary = summary if summary else extract_summary(new_content)
        self.transcript_history += transcript + "... "
        self.modified_at = datetime.now()
        self.num_appends += 1


class DecisionTree:
    def __init__(self):
        self.tree: Dict[int, Node] = {}
        self.next_node_id: int = 0

    def create_new_node(self, name: str, parent_node_id: int | None, content: str, summary : str, relationship_to_parent: str = "child of") -> int:
        if parent_node_id is not None and parent_node_id not in self.tree:
            logging.error(f"Error: Trying to create a node with non-existent parent ID: {parent_node_id}")
            parent_node_id = None

        # Check if a similar node already exists as a child of this parent
        existing_child_id = self._find_similar_child(name, parent_node_id)
        if existing_child_id is not None:
            logging.info(f"Found existing similar child node '{self.tree[existing_child_id].title}' (ID: {existing_child_id}) under parent {parent_node_id}. Returning existing node instead of creating duplicate.")
            return existing_child_id

        # Only get and increment node_id after validation passes
        new_node_id = self.next_node_id
        new_node = Node(name, new_node_id, content, parent_id=parent_node_id)
        if parent_node_id is not None:
            new_node.relationships[parent_node_id] = relationship_to_parent
        
        # Only increment after we successfully create the node
        self.tree[new_node_id] = new_node
        if parent_node_id is not None:
            self.tree[parent_node_id].children.append(new_node_id)
        self.tree[new_node_id].summary = summary if summary else extract_summary(content)
        
        # Increment AFTER successful creation
        self.next_node_id += 1

        return new_node_id

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

    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        # assumes tree invariant
        for parent_id, node in self.tree.items():
            if node_id in node.children:
                return parent_id
        return None

    def get_node_id_from_name(self, name: str) -> int | None:
        """
        Search the tree for the node with the name most similar to the input name.
        Uses fuzzy matching to find the closest match.

        Args:
            name (str): The name of the node to find.

        Returns:
            int | None: The ID of the closest matching node, or None if no close match is found.
        """
        # Generate a list of node titles
        node_titles = [node.title for node in self.tree.values()]
        node_titles_lower = [title.lower() for title in node_titles]

        # Find the closest match to the input name
        closest_matches = difflib.get_close_matches(name.lower(), node_titles_lower, n=1, cutoff=0.6)

        if closest_matches:
            # If a match is found, return the corresponding node ID
            # Find the original title that matched
            matched_lower = closest_matches[0]
            for i, title_lower in enumerate(node_titles_lower):
                if title_lower == matched_lower:
                    original_title = node_titles[i]
                    break
            
            for node_id, node in self.tree.items():
                if node.title == original_title:
                    return node_id

        #todo: this won't scale

        # If no match is found, try to use the most recently modified node
        # This is more likely to be semantically related
        recent_nodes = self.get_recent_nodes(num_nodes=5)
        
        if recent_nodes:
            parent_id = recent_nodes[0]
            logging.warning(f"No close match found for node name '{name}'. Using most recent node: {self.tree[parent_id].title}")
            return parent_id
        
        # Return None if there are no nodes at all
        logging.warning(f"No close match found for node name '{name}' and no nodes exist in the tree.")
        return None