import logging
import os
from pathlib import Path
from typing import Any, Optional

from backend.markdown_tree_manager.markdown_to_tree.comprehensive_parser import (
    parse_markdown_file_complete,
)
from backend.markdown_tree_manager.markdown_to_tree.comprehensive_parser import (
    parse_relationships_from_links,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.types import ParsedNodeKeys, RelationshipKeys


class MarkdownToTreeConverter:
    """Converts markdown files back to tree data structure"""

    # Directories to exclude from recursive scanning
    EXCLUDED_DIRS = {'.obsidian', '.git', 'chromadb_data', 'node_modules', '__pycache__', '.venv', 'ctx-nodes', 'CTX- nodes'}

    def __init__(self):
        self.tree_data: dict[int, Node] = {}
        self.filename_to_node_id: dict[str, int] = {}
        # Also index by basename for resolving links that don't use full paths
        self._basename_to_relative_path: dict[str, str] = {}

    def _should_exclude_path(self, filepath: Path, root: Path) -> bool:
        """Check if a path should be excluded from scanning."""
        relative = filepath.relative_to(root)
        # Exclude if any part of the path starts with '.' or is in EXCLUDED_DIRS
        for part in relative.parts:
            if part.startswith('.') or part in self.EXCLUDED_DIRS:
                return True
        return False

    def _resolve_filename(self, link_filename: str) -> Optional[str]:
        # todo, this feels like an unnecessary layer of indirection and just overall introducing debt
        """
        Resolve a filename from a link to the actual relative path.
        Handles both full relative paths and basenames.
        """
        # First try exact match (for full relative paths)
        if link_filename in self.filename_to_node_id:
            return link_filename
        # Fall back to basename match (for legacy links using just the filename)
        if link_filename in self._basename_to_relative_path:
            return self._basename_to_relative_path[link_filename]
        return None

    def load_tree_from_markdown(self, markdown_dir: str) -> dict[int, Node]:
        """
        Main entry point to load a tree from markdown files

        Args:
            markdown_dir: Directory containing markdown files

        Returns:
            Dictionary mapping node_id to Node objects
        """
        # logging.info(f"Loading tree from markdown directory: {markdown_dir}")

        if not os.path.exists(markdown_dir):
            raise ValueError(f"Markdown directory does not exist: {markdown_dir}")

        # First pass: Load all nodes and build filename mapping (recursively scan subfolders)
        markdown_dir_path = Path(markdown_dir)
        all_md_files = list(markdown_dir_path.rglob('*.md'))
        # Filter out excluded directories
        markdown_files = [f for f in all_md_files if not self._should_exclude_path(f, markdown_dir_path)]

        next_generated_id = 1
        for filepath in markdown_files:
            # Use relative path from markdown_dir as the filename
            relative_path = str(filepath.relative_to(markdown_dir_path))
            try:
                node = self._parse_markdown_file(str(filepath), relative_path)
                if node:
                    # Assign integer ID if node has None ID (no node_id in frontmatter)
                    if node.id is None:
                        node.id = next_generated_id
                        next_generated_id += 1
                    elif isinstance(node.id, int):
                        # Track max to avoid collisions with generated IDs
                        next_generated_id = max(next_generated_id, node.id + 1)

                    self.tree_data[node.id] = node
                    self.filename_to_node_id[relative_path] = node.id
                    # Also index by basename for link resolution
                    basename = filepath.name
                    if basename not in self._basename_to_relative_path:
                        self._basename_to_relative_path[basename] = relative_path
            except Exception as e:
                logging.error(f"Error parsing file {relative_path}: {e}")

        # Second pass: Resolve relationships
        for filepath in markdown_files:
            relative_path = str(filepath.relative_to(markdown_dir_path))
            try:
                self._parse_relationships(str(filepath), relative_path)
            except Exception as e:
                logging.error(f"Error parsing relationships in {relative_path}: {e}")

        # logging.info(f"Loaded {len(self.tree_data)} nodes from markdown")
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
            name=parsed_data[ParsedNodeKeys.TITLE],
            node_id=parsed_data[ParsedNodeKeys.NODE_ID],
            content=parsed_data[ParsedNodeKeys.CONTENT],
            summary=parsed_data[ParsedNodeKeys.SUMMARY]
        )

        # Set all attributes from parsed data
        node.created_at = parsed_data[ParsedNodeKeys.CREATED_AT]
        node.modified_at = parsed_data[ParsedNodeKeys.MODIFIED_AT]
        node.filename = filename

        if parsed_data[ParsedNodeKeys.TAGS]:
            node.tags = parsed_data[ParsedNodeKeys.TAGS]

        if parsed_data[ParsedNodeKeys.COLOR]:
            node.color = parsed_data[ParsedNodeKeys.COLOR]

        return node


    def _parse_relationships(self, filepath: str, filename: str) -> None:

        # this new method looks super sus. can't we just set

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
        with open(filepath, encoding='utf-8') as f:
            content = f.read()

        # Use the module's relationship parser
        relationships = parse_relationships_from_links(content)

        # Process parent relationship
        if relationships[RelationshipKeys.PARENT]:
            parent_filename = relationships[RelationshipKeys.PARENT][RelationshipKeys.PARENT_FILENAME]
            relationship_type = relationships[RelationshipKeys.PARENT][RelationshipKeys.RELATIONSHIP_TYPE]

            resolved_parent = self._resolve_filename(parent_filename)
            if resolved_parent:
                parent_id = self.filename_to_node_id[resolved_parent]
                node.parent_id = parent_id
                node.relationships[parent_id] = relationship_type

                # Add this node as child to parent
                if parent_id in self.tree_data:
                    parent_node = self.tree_data[parent_id]
                    if node_id not in parent_node.children:
                        parent_node.children.append(node_id)

        # Process children relationships (if any)
        for child_info in relationships[RelationshipKeys.CHILDREN]:
            child_filename = child_info[RelationshipKeys.CHILD_FILENAME]
            relationship_type = child_info[RelationshipKeys.RELATIONSHIP_TYPE]

            resolved_child = self._resolve_filename(child_filename)
            if resolved_child:
                child_id = self.filename_to_node_id[resolved_child]
                if child_id not in node.children:
                    node.children.append(child_id)

                # Set the relationship from child's perspective
                if child_id in self.tree_data:
                    child_node = self.tree_data[child_id]
                    child_node.parent_id = node_id
                    child_node.relationships[node_id] = relationship_type


def load_markdown_tree(markdown_dir: str, embedding_manager: Any = None) -> MarkdownTree:
    """
    Convenience function to load a tree from markdown files

    Args:
        markdown_dir: Directory containing markdown files
        embedding_manager: Optional existing embedding manager to reuse

    Returns:
        MarkdownTree object with loaded nodes
    """
    converter = MarkdownToTreeConverter()
    tree_dict = converter.load_tree_from_markdown(markdown_dir)

    # Create MarkdownTree object with the loaded data
    markdown_tree = MarkdownTree(output_dir=markdown_dir, embedding_manager=embedding_manager)
    markdown_tree.tree = tree_dict

    # Set the next_node_id based on the highest existing ID
    if tree_dict:
        # Filter for valid integer IDs only
        int_keys = []
        for k in tree_dict.keys():
            try:
                int_keys.append(int(k))
            except (ValueError, TypeError):
                logging.warning(f"Skipping non-integer node ID: {k}")

        if int_keys:
            markdown_tree.next_node_id = max(int_keys) + 1
        else:
            markdown_tree.next_node_id = 1

    # Sync loaded nodes to embeddings
    if markdown_tree._embedding_manager and markdown_tree.tree:
        # logging.info(f"Syncing {len(markdown_tree.tree)} loaded nodes to embeddings...")
        markdown_tree._embedding_manager.sync_all_embeddings()
        logging.info("Embedding sync complete")

    return markdown_tree


def load_markdown_repository_for_themes(input_forest_path: str) -> dict[int, Node]:
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
    for node in tree_data.tree.values():
        if hasattr(node, 'color'):
            node.color = None

    return tree_data
