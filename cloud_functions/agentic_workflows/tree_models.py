"""
Minimal tree data structures and utilities for cloud function agents.

These are simplified versions containing only what the agents need.
"""

import logging
from typing import Any, Optional


class Node:
    """Minimal Node class for cloud function agents"""

    def __init__(
        self,
        name: str,
        node_id: int,
        content: str,
        summary: str = "",
        parent_id: Optional[int] = None
    ):
        self.id: int = node_id
        self.title: str = name
        self.content: str = content
        self.summary: str = summary
        self.parent_id: Optional[int] = parent_id
        self.children: list[int] = []
        self.relationships: dict[int, str] = {}


class MarkdownTree:
    """Minimal MarkdownTree class for cloud function agents"""

    def __init__(self):
        self.tree: dict[int, Node] = {}
        self.roots: list[int] = []


# Utility functions

def format_nodes_for_prompt(
    nodes: list[Node],
    tree: Optional[dict[int, Node]] = None,
    include_full_content: bool = False
) -> str:
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
            relationship = node.relationships.get(node.parent_id, "child of")
            parent_title = tree[node.parent_id].title if node.parent_id in tree else "Unknown"
            node_entry.append(f"Relationship: {relationship} ('{parent_title})'")

        formatted_nodes.append("\n".join(node_entry))
        formatted_nodes.append("-" * 40)

    formatted_nodes.append("==========================")

    return "\n".join(formatted_nodes)


def map_titles_to_node_ids(
    titles: list[str],
    nodes: list[Any],
    fuzzy_match: bool = True
) -> list[int]:
    """Map node titles to their IDs, with optional fuzzy matching

    Args:
        titles: List of node titles to map
        nodes: List of Node objects to search
        fuzzy_match: If True, attempts fuzzy matching for unmatched titles

    Returns:
        List of node IDs corresponding to the titles
    """
    title_to_id = {node.title: node.id for node in nodes}
    node_ids = []

    for title in titles:
        if title in title_to_id:
            node_ids.append(title_to_id[title])
        elif fuzzy_match:
            # Simple fuzzy match: case-insensitive partial match
            matched = False
            for node in nodes:
                if title.lower() in node.title.lower() or node.title.lower() in title.lower():
                    node_ids.append(node.id)
                    matched = True
                    break
            if not matched:
                logging.warning(f"No match found for title: '{title}'")

    return node_ids
