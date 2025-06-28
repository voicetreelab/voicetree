# treeToMarkdown.py
import logging
import os
import re
import traceback

from rake_nltk import Rake
from backend.text_to_graph_pipeline.tree_manager.utils import deduplicate_content


def generate_filename_from_keywords(node_title, max_keywords=3):
    # note, could also do this with rake keyword extraction
    file_name = node_title
    file_name = re.sub(r'summary\s*:', '', file_name, flags=re.IGNORECASE)  # Remove "summary:"
    file_name = re.sub(r'#+\s*title\s*:', '', file_name, flags=re.IGNORECASE)  # Remove "## title"
    file_name = file_name.replace(" ", "_")
    file_name = file_name.replace("*", "")
    file_name = file_name.replace(".", "")
    file_name = file_name.replace(",", "")
    file_name = file_name.replace("#", "")
    file_name = file_name.replace(":", "")
    file_name = file_name.replace("\\", "")
    file_name = file_name.replace("__", "_")

    return file_name + ".md"


def slugify(text):
    """Converts text to a valid filename."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    text = text.strip('_')
    return text


class TreeToMarkdownConverter:
    def __init__(self, tree_data):
        # self.mContextualTreeManager = contextual_tree_manager
        self.tree_data = tree_data

    def convert_tree(self, output_dir="markdownTreeVaultDefault"):
        """Converts the tree data to Markdown files."""

        for node_id, node_data in self.tree_data.items():
            file_name = f"{slugify(node_data['content'])}.md"
            file_path = os.path.join(output_dir, file_name)

            with open(file_path, 'w') as f:
                f.write(f"# {node_data['content']}\n")

                # Add child links
                for child_id in node_data['children']:
                    child_file_name = f"{child_id:02d}_{slugify(self.tree_data[child_id]['content'])}.md"
                    f.write(f"- child of [[{child_file_name}]]\n")

    def convert_node(self, output_dir="markdownTreeVaultDefault", nodes_to_update=None):
        """Converts the specified nodes to Markdown files."""

        os.makedirs(output_dir, exist_ok=True)
        logging.info(f"updating/writing markdown for nodes {nodes_to_update}")

        if nodes_to_update:
            for node_id in nodes_to_update:
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
                        if not node_data.content or "###" not in node_data.content:
                            f.write(f"### {node_data.summary}\n\n")

                        # Deduplicate content before writing to improve quality
                        clean_content = deduplicate_content(node_data.content)
                        f.write(f"{clean_content}\n\n\n-----------------\n_Links:_\n")

                        # Add child links
                        for child_id in node_data.children:
                            child_node = self.tree_data.get(child_id)
                            if child_node:
                                child_file_name = child_node.filename
                                # Get the relationship from child's perspective
                                child_relationship = "child of"
                                if child_id in self.tree_data and node_id in self.tree_data[child_id].relationships:
                                    child_relationship = self.tree_data[child_id].relationships[node_id]
                                f.write(f"- parent of [[{child_file_name}]] ({child_relationship} this node)\n")

                        # add parent backlinks
                        parent_id = self.get_parent_id(node_id)
                        if parent_id is not None:
                            parent_file_name = self.tree_data[parent_id].filename
                            relationship_to_parent = "child of"
                            try:
                                relationship_to_parent = self.tree_data[node_id].relationships[parent_id]
                            except Exception as e:
                                logging.error("Parent relationship not in tree_data")
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

    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        for parent_id, node_data in self.tree_data.items():
            if node_id in node_data.children:
                return parent_id
        return None
