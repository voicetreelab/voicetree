# treeToMarkdown.py
import logging
import os
import re
import traceback
from typing import Optional, Any

# Import Node for both type checking and runtime use
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.markdown_tree_manager.utils import generate_filename_from_keywords
from backend.markdown_tree_manager.utils import insert_yaml_frontmatter


def extract_extra_links_from_file(file_path: str) -> list[str]:
    # todo, this is really awful. we shouldn't have to do this.
    # but since we are, todo, we should atleasst not add complex parsing logic
    # todo, just get all wikilinks, then afterwards, add back any wikilinkss that are no longer in the markdown content after writing


    """
    Extract extra links from an existing markdown file that should be preserved.

    These are links that appear after the _Links:_ section but are NOT part of
    the Children: section (e.g., external context links added by UI or other tools).

    Args:
        file_path: Path to the existing markdown file

    Returns:
        List of extra link lines to preserve (without trailing newlines)
    """
    if not os.path.exists(file_path):
        return []

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except (OSError, IOError):
        return []

    # Find the _Links:_ section
    links_match = re.search(r'_Links:_\s*\n(.*)', content, re.DOTALL)
    if not links_match:
        return []

    links_content = links_match.group(1)
    lines = links_content.split('\n')

    extra_links = []
    in_children_section = False

    for line in lines:
        stripped = line.strip()

        # Skip empty lines
        if not stripped:
            continue

        # Detect start of Children: section
        if stripped == 'Children:':
            in_children_section = True
            continue

        # If in Children: section, skip child link lines (start with "- ")
        if in_children_section:
            if stripped.startswith('- '):
                continue
            else:
                # End of Children: section - any subsequent content is extra
                in_children_section = False

        # This is an extra link to preserve (e.g., [[ctx-nodes/...]])
        if '[[' in stripped and ']]' in stripped:
            extra_links.append(stripped)

    return extra_links


class TreeToMarkdownConverter:
    def __init__(self, tree_data: dict[int, 'Node']):
        # self.mContextualTreeManager = contextual_tree_manager
        self.tree_data = tree_data

    def convert_nodes(self, output_dir: str, nodes_to_update: Optional[set[int]] = None) -> None:
        """Converts the specified nodes to Markdown files."""
        logging.info(f"TreeToMarkdownConverter.convert_nodes called with output_dir='{output_dir}' (absolute: {os.path.abspath(output_dir)})")

        os.makedirs(output_dir, exist_ok=True)
        os.makedirs(os.path.join(output_dir, "voice"), exist_ok=True)  # Ensure voice subdirectory exists
        if nodes_to_update and len(nodes_to_update) > 0:
            logging.info(f"updating/writing markdown for nodes {nodes_to_update}")

        if nodes_to_update:
            for node_id in nodes_to_update:
                self.convert_node(node_id, output_dir)

    def convert_node(self, node_id: int, output_dir: str) -> None:
        try:
            node_data = self.tree_data[node_id]
            if node_data.filename:
                file_name = node_data.filename
            else:
                file_name = generate_filename_from_keywords(node_data.content)
                node_data.filename = file_name  # Store the filename
                # title_match = re.search(r'^##+(.*)', node_data.content, re.MULTILINE)
                # node_data.content.replace(title_match.group(0), "")
            file_path = os.path.join(output_dir, file_name)

            # Preserve extra links from existing file before overwriting
            extra_links = extract_extra_links_from_file(file_path)

            with open(file_path, 'w') as f:
                # Write tags as hashtags on first line if tags exist
                if node_data.tags:
                    hashtags = ' '.join(f"#{tag}" for tag in node_data.tags)
                    f.write(f"{hashtags}\n")

                # Write YAML frontmatter with timestamps, read back at parse_markdown_file_complete
                frontmatter = insert_yaml_frontmatter({
                    "created_at": node_data.created_at.isoformat(),
                    "modified_at": node_data.modified_at.isoformat(),
                    "node_id": node_id,
                })


                f.write(frontmatter)

                # Write title as first markdown heading (unless skip_title is set)
                if not getattr(node_data, 'skip_title', False):
                    f.write(f"# {node_data.title}\n\n")

                # Write summary as second heading
                if node_data.summary and node_data.summary.strip():
                    if "#" not in node_data.summary:
                        f.write(f"### {node_data.summary}\n\n")
                    else:
                        f.write(f"{node_data.summary}\n")

                # Deduplicate content before writing to improve quality
                clean_content = node_data.content
                f.write(f"{clean_content}\n\n\n-----------------\n_Links:_\n")

                # Add child links from parent's perspective
                if node_data.children:
                    f.write(f"Children:\n")
                    for child_id in node_data.children:
                        child_node = self.tree_data.get(child_id)
                        if child_node:
                            if not child_node.filename:
                                logging.warning(f"Child node {child_id} missing filename")
                                continue
                            child_file_name = child_node.filename
                            # Get the relationship from child's perspective
                            child_relationship = "child of"
                            if child_id in self.tree_data and node_id in self.tree_data[child_id].relationships:
                                child_relationship = self.tree_data[child_id].relationships[node_id]
                                child_relationship = self.convert_to_snake_case(child_relationship)
                            f.write(f"- {child_relationship} [[{child_file_name}]]\n")
                        else:
                            logging.error(f"Child node {child_id} not found in tree_data")

                # Write preserved extra links (e.g., context links added by UI)
                if extra_links:
                    f.write("\n")
                    for link in extra_links:
                        f.write(f"{link}\n")

                # Flush to ensure immediate file visibility
                f.flush()
                os.fsync(f.fileno())

        except (FileNotFoundError, OSError) as e:
            logging.error(
                f"Error writing Markdown file for node {node_id}: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")
        except Exception as e:
            logging.error(
                f"Unexpected error writing Markdown file for node {node_id}: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")

    @staticmethod
    def convert_to_snake_case(to_convert: str) -> str:
        return to_convert.replace(" ", "_")


    def get_parent_id(self, node_id: int) -> Optional[int]:
        """Returns the parent ID of the given node, or None if it's the root."""
        for parent_id, node_data in self.tree_data.items():
            if node_id in node_data.children:
                return parent_id
        return None


def format_nodes_for_prompt(nodes: list[Node], tree: Optional[dict[int, Node]] = None, include_full_content: bool = False) -> str:
    """Format nodes for LLM prompt in a consistent, readable format

    Args:
        nodes: List of nodes to format
        tree: Optional tree dict for relationship context
        include_full_content: If True, includes full content instead of summary

    Returns:
        Formatted string representation of nodes
    """
    if not nodes:
        return "No nodes available"

    formatted_nodes = []
    formatted_nodes.append("===== Available Nodes =====")

    for node in nodes:
        node_entry = []
        node_entry.append(f"Node ID: {node.id}")
        node_entry.append(f"Title: {node.title}")

        if include_full_content:
            node_entry.append(f"Content: {node.content}")
        elif node.summary:
            node_entry.append(f"Summary: {node.summary}")
            node_entry.append(f"Content: {node.content[:1000]}")
        else:
            node_entry.append(f"Summary: {node.content[:1000]}")

        if node.parent_id and tree:
            node_entry.append(f"Relationship: {node.relationships[node.parent_id]} ('{tree[node.parent_id].title})'")

        formatted_nodes.append("\n".join(node_entry))
        formatted_nodes.append("-" * 40)

    formatted_nodes.append("==========================")

    return "\n".join(formatted_nodes)


def _format_nodes_for_prompt(nodes: list[Node], tree: Optional[dict[int, Node]] = None) -> str:
    """Format nodes for LLM prompt in a consistent, readable format (deprecated, use format_nodes_for_prompt)"""
    return format_nodes_for_prompt(nodes, tree, include_full_content=False)
