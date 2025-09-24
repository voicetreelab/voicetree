import difflib
import logging
import re
from datetime import datetime
from typing import Any
from typing import Optional

# Import these after Node class is defined to avoid circular import issues
from backend.markdown_tree_manager.utils import extract_summary
from backend.markdown_tree_manager.utils import generate_filename_from_keywords


def extract_title_from_md(node_content: str) -> str:
    title_match = re.search(r'#+(.*)', node_content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "Untitled"
    title = title.lower()
    return title

class Node:
    def __init__(self, name : str, node_id: int, content: str, summary: str = "", parent_id: Optional[int] = None):
        self.transcript_history = ""
        self.id: int = node_id
        self.content: str = content
        self.parent_id: int | None = parent_id
        self.children: list[int] = []
        self.relationships: dict[int, str] = {}
        self.created_at: datetime = datetime.now()
        self.modified_at: datetime = datetime.now()
        self.title = name
        self.filename: str = str(node_id) + "_" + generate_filename_from_keywords(self.title)
        self.summary: str = summary
        self.num_appends: int = 0
        self.tags: list[str] = []  # Support for multiple tags per node
        self.color: Optional[str] = None  # Support for color attribute



class MarkdownTree:
    def __init__(self, output_dir: Optional[str] = None, embedding_manager: Any = None) -> None:
        """
        Initialize MarkdownTree.

        Args:
            output_dir: Directory for markdown output
            embedding_manager: Optional embedding manager instance.
                             If None, will create real or mock based on environment.
                             Pass False to explicitly disable.
        """
        self.tree: dict[int, Node] = {}
        self.next_node_id: int = 1
        self.output_dir = output_dir or "markdownTreeVaultDefault"
        self._markdown_converter = None  # Will be set to TreeToMarkdownConverter when needed
        self._pending_embedding_updates: set[int] = set()  # Batch embedding updates
        self._embedding_batch_size = 6  # Update embeddings when we have this many pending

        # Dependency injection for embedding manager
        if embedding_manager is False:
            # Explicitly disabled
            self._embedding_manager = None
        elif embedding_manager is not None:
            # Use injected manager
            self._embedding_manager = embedding_manager
        else:
            # Create default based on environment
            self._embedding_manager = self._create_default_embedding_manager()

    @property
    def markdown_converter(self) -> Any:
        """Lazy initialization of markdown converter"""
        if self._markdown_converter is None:
            # Import here to avoid circular dependency
            from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
                TreeToMarkdownConverter,
            )
            self._markdown_converter = TreeToMarkdownConverter(self.tree)
        return self._markdown_converter

    def _create_default_embedding_manager(self) -> Any:
        """Create default embedding manager based on environment"""
        import os
        if os.getenv('VOICETREE_TEST_MODE', '').lower() == 'true':
            # Test mode - return mock
            return self._create_mock_embedding_manager()
        else:
            # Production mode - return real manager
            try:
                from backend.markdown_tree_manager.embeddings.embedding_manager import (
                    EmbeddingManager,
                )
                manager = EmbeddingManager(tree=self, enabled=True)
                logging.info("Real embeddings initialized")
                return manager
            except Exception as e:
                logging.error(f"Failed to initialize embeddings: {e}")
                return self._create_mock_embedding_manager()  # Fallback to mock

    def _create_mock_embedding_manager(self) -> Any:
        """Create a mock embedding manager for tests"""
        class MockEmbeddingManager:
            def __init__(self) -> None:
                self.enabled = True
                self.vector_store = self

            def search(self, query: str, top_k: int) -> list[int]:
                return []

            def update_embeddings(self, node_ids: list[int]) -> None:
                pass  # No-op

            def add_nodes(self, nodes: dict[int, 'Node']) -> None:
                pass  # No-op

        return MockEmbeddingManager()

    def _update_embeddings(self, node_ids: list[int], force: bool = False) -> None:
        """Queue embedding updates and batch process when threshold is reached.

        Args:
            node_ids: Node IDs to update
            force: If True, process all pending updates immediately
        """
        if not self._embedding_manager or not node_ids:
            return

        # Add to pending updates
        self._pending_embedding_updates.update(node_ids)

        # Process if we've reached batch size or forcing
        if force or len(self._pending_embedding_updates) >= self._embedding_batch_size:
            self._flush_embedding_updates()

    def _flush_embedding_updates(self) -> None:
        """Process all pending embedding updates in a batch."""
        if not self._embedding_manager or not self._pending_embedding_updates:
            return

        try:
            # Get actual nodes from tree
            nodes_to_update = {
                nid: self.tree[nid]
                for nid in self._pending_embedding_updates
                if nid in self.tree
            }

            if nodes_to_update:
                self._embedding_manager.vector_store.add_nodes(nodes_to_update)
                logging.debug(f"Batch updated embeddings for {len(nodes_to_update)} nodes")

            # Clear pending updates
            self._pending_embedding_updates.clear()

        except Exception as e:
            logging.error(f"Failed to batch update embeddings: {e}")
            # Don't clear on error - retry next time

    def flush_embeddings(self) -> None:
        """Public method to force flush all pending embedding updates."""
        self._flush_embedding_updates()
        # note, we shouldn't force flush, instead
        # functions that rely on embeddings should include the unupdated by default
        # or force flush i guess

    def _write_markdown_for_nodes(self, node_ids: list[int]) -> None:
        """Write markdown files for the specified nodes"""
        if node_ids:
            try:
                self.markdown_converter.convert_nodes(
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
            # TODO: Consider adding inverse relationship storage in parent node for easier lookups

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

        # Update embeddings
        self._update_embeddings(nodes_to_update)

        return new_node_id

    def update_node(self, node_id: int, content: str, summary: str, update_embeddings: bool = True) -> None:
        """
        Replaces a node's content and summary completely.

        Args:
            node_id: The ID of the node to update
            content: The new content to replace existing content
            summary: The new summary to replace existing summary
            update_embeddings: Whether to update embeddings (False for sync operations)

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

        # Update embeddings only if requested (not for sync operations)
        if update_embeddings:
            self._update_embeddings([node_id])

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

        # Update embeddings
        self._update_embeddings([node_id])

    def get_node_id_from_name(self, name: str, similarity_threshold: float = 0.8) -> Optional[int]:
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

    def get_recent_nodes(self, num_nodes: int = 10) -> list[int]:
        """Returns a list of IDs of the most recently modified nodes."""
        sorted_nodes = sorted(self.tree.keys(), key=lambda k: self.tree[k].modified_at, reverse=True)
        return sorted_nodes[:num_nodes]

    def get_nodes_by_branching_factor(self, limit: Optional[int] = None) -> list[int]:
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

    def get_parent_id(self, node_id: int) -> Optional[int]:
        """Returns the parent ID of the given node, or None if it's the root."""
        # assumes tree invariant
        for parent_id, node in self.tree.items():
            if node_id in node.children:
                return parent_id
        return None


    def get_neighbors(self, node_id: int, max_neighbours:int =30) -> list[dict[str, Any]]:
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
                "relationship": node.relationships[node.parent_id] # todo, specify in text relationship from CHILD to PARENT
            })

            # TODO: Sibling functionality commented out - unsure whether we want to return siblings yet
            # # Get siblings (other children of the same parent)
            # for sibling_id in parent_node.children:
            #     if sibling_id != node_id and sibling_id in self.tree:
            #         sibling_node = self.tree[sibling_id]
            #         neighbors.append({
            #             "id": sibling_id,
            #             "name": sibling_node.title,
            #             "summary": sibling_node.summary,
            #             "relationship": "sibling"
            #         })

        # Get children
        for child_id in node.children:
            if len(neighbors) >= max_neighbours:
                break
            if child_id in self.tree:
                child_node = self.tree[child_id]
                neighbors.append({
                    "id": child_id,
                    "name": child_node.title,
                    "summary": child_node.summary,
                    "relationship": child_node.relationships[node_id]
                    # todo, specify in text relationship from PARENT to CHILD
                })

        return neighbors

    def search_similar_nodes(self, query: str, top_k: int = 10) -> list[int]:
        """
        Search for similar nodes using embeddings.

        Args:
            query: Search query text
            top_k: Number of results to return

        Returns:
            List of node IDs ordered by relevance
        """
        # Flush any pending updates before searching
        self.flush_embeddings()

        if self._embedding_manager:
            try:
                return self._embedding_manager.search(query, top_k)
            except Exception as e:
                logging.error(f"Search failed: {e}")
        return []

    def search_similar_nodes_vector(self, query: str, top_k: int = 10) -> list[tuple[int, float]]:
        """
        Search for similar nodes using vector embeddings with scores.

        Args:
            query: Search query text
            top_k: Number of results to return

        Returns:
            List of (node_id, similarity_score) tuples ordered by relevance
        """
        self.flush_embeddings()

        if self._embedding_manager:
            try:
                # Use the embedding manager's search with scores
                results = self._embedding_manager.vector_store.search(
                    query=query,
                    top_k=top_k,
                    include_scores=True
                )
                # Ensure we return List[Tuple[int, float]]
                if isinstance(results, list) and results and isinstance(results[0], tuple):
                    return results
            except Exception as e:
                logging.error(f"Vector search failed: {e}")
        return []

    def remove_node(self, node_id: int) -> bool:
        """
        Remove node from tree and delete its markdown file.

        Args:
            node_id: The ID of the node to remove

        Returns:
            True if node was successfully removed, False if node didn't exist
        """
        if node_id not in self.tree:
            logging.warning(f"Cannot remove node {node_id}: not found in tree")
            return False

        node = self.tree[node_id]

        # Delete markdown file if it exists
        import os
        markdown_path = os.path.join(self.output_dir, node.filename)
        if os.path.exists(markdown_path):
            try:
                os.unlink(markdown_path)
                logging.info(f"Deleted markdown file: {markdown_path}")
            except OSError as e:
                logging.error(f"Failed to delete markdown file {markdown_path}: {e}")

        # Remove from parent's children list
        if node.parent_id is not None and node.parent_id in self.tree:
            parent_node = self.tree[node.parent_id]
            if node_id in parent_node.children:
                parent_node.children.remove(node_id)
                # Update parent's markdown
                self._write_markdown_for_nodes([node.parent_id])

        # Update children to remove this node as parent
        for child_id in node.children:
            if child_id in self.tree:
                child_node = self.tree[child_id]
                child_node.parent_id = None
                # Update child's markdown
                self._write_markdown_for_nodes([child_id])

        # Remove embeddings
        if self._embedding_manager:
            try:
                self._embedding_manager.delete_embeddings({node_id})
            except Exception as e:
                logging.error(f"Failed to delete embeddings for node {node_id}: {e}")

        # Remove from tree
        del self.tree[node_id]
        logging.info(f"Removed node {node_id}: {node.title}")

        return True

