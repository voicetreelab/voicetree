# treeToMarkdown.py
import logging
import os
import traceback
from typing import Dict
from typing import List
from typing import Optional

# Import Node for both type checking and runtime use
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.markdown_tree_manager.utils import generate_filename_from_keywords
from backend.markdown_tree_manager.utils import insert_yaml_frontmatter


class TreeToMarkdownConverter:
    def __init__(self, tree_data: Dict[int, 'Node']):
        # self.mContextualTreeManager = contextual_tree_manager
        self.tree_data = tree_data

    def convert_nodes(self, output_dir="markdownTreeVaultDefault", nodes_to_update=None):
        """Converts the specified nodes to Markdown files."""

        os.makedirs(output_dir, exist_ok=True)
        if (len(nodes_to_update)> 0):
            logging.info(f"updating/writing markdown for nodes {nodes_to_update}")

        if nodes_to_update:
            for node_id in nodes_to_update:
                self.convert_node(node_id, output_dir)

    def convert_node(self, node_id, output_dir):
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

            with open(file_path, 'w') as f:
                # Write tags as hashtags on first line if tags exist
                if node_data.tags:
                    hashtags = ' '.join(f"#{tag}" for tag in node_data.tags)
                    f.write(f"{hashtags}\n")
                
                # Write YAML frontmatter
                frontmatter = insert_yaml_frontmatter({
                    "title": f"{node_data.title} ({node_id})",
                    "node_id": node_id,
                })
                f.write(frontmatter)

                if node_data.summary and node_data.summary.strip():
                    if "#" not in node_data.summary:
                        f.write(f"### {node_data.summary}\n\n")
                    else:
                        f.write(f"{node_data.summary}\n")

                # Deduplicate content before writing to improve quality
                clean_content = node_data.content
                f.write(f"{clean_content}\n\n\n-----------------\n_Links:_\n")

                # Add child links
                # DISABLING BECAUES IT JUST ADDS NOISE, WE CAN USE OBSIDIAN BACKLINKS INSTEAD

                # if node_data.children:
                #     f.write(f"Children:\n")
                # for child_id in node_data.children:
                #     child_node = self.tree_data.get(child_id)
                #     if child_node:
                #         if not child_node.filename:
                #             logging.warning(f"Child node {child_id} missing filename")
                #             continue
                #         child_file_name = child_node.filename
                #         # Get the relationship from child's perspective
                #         child_relationship = "child of"
                #         if child_id in self.tree_data and node_id in self.tree_data[child_id].relationships:
                #             child_relationship = self.tree_data[child_id].relationships[node_id]
                #             child_relationship = self.convert_to_snake_case(child_relationship)
                #         f.write(f"- [[{child_file_name}]] {child_relationship} (this node)\n")
                #     else:
                #         logging.error(f"Child node {child_id} not found in tree_data")

                # # add parent links


                parent_id = self.get_parent_id(node_id)
                if parent_id is not None:
                    f.write("Parent:\n")
                    parent_file_name = self.tree_data[parent_id].filename
                    relationship_to_parent = "child of"
                    try:
                        relationship_to_parent = self.tree_data[node_id].relationships[parent_id]
                    except Exception:
                        logging.error("Parent relationship not in tree_data")
                    relationship_to_parent = self.convert_to_snake_case(relationship_to_parent)
                    f.write(f"- {relationship_to_parent} [[{parent_file_name}]]\n")

                # Flush to ensure immediate file visibility
                f.flush()
                os.fsync(f.fileno())

        except (FileNotFoundError, IOError, OSError) as e:
            logging.error(
                f"Error writing Markdown file for node {node_id}: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")
        except Exception as e:
            logging.error(
                f"Unexpected error writing Markdown file for node {node_id}: {e} - Type: {type(e)} - Traceback: {traceback.format_exc()}")

    @staticmethod
    def convert_to_snake_case(to_convert: str):
        return to_convert.replace(" ", "_")


    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        for parent_id, node_data in self.tree_data.items():
            if node_id in node_data.children:
                return parent_id
        return None


def format_nodes_for_prompt(nodes: List[Node], tree: Optional[Dict[int, Node]] = None, include_full_content: bool = False) -> str:
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
        else:
            node_entry.append(f"Summary: {node.content[:1000]}")

        if node.parent_id and tree:
            node_entry.append(f"Relationship: {node.relationships[node.parent_id]} ('{tree[node.parent_id].title})'")

        formatted_nodes.append("\n".join(node_entry))
        formatted_nodes.append("-" * 40)

    formatted_nodes.append("==========================")

    return "\n".join(formatted_nodes)


def _format_nodes_for_prompt(nodes: List[Node], tree: Optional[Dict[int, Node]] = None) -> str:
    """Format nodes for LLM prompt in a consistent, readable format (deprecated, use format_nodes_for_prompt)"""
    return format_nodes_for_prompt(nodes, tree, include_full_content=False)