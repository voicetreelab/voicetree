"""
Consolidated type definitions for the VoiceTree backend.

This module contains all TypedDict definitions used across the backend
to avoid duplication and ensure consistency.
"""

from datetime import datetime
from typing import Any, List, Optional, TypedDict, Union
from numpy.typing import NDArray


# Node data structures for context retrieval and general use
class NodeData(TypedDict, total=False):
    """Type definition for node data from load_node operations."""
    filename: str
    title: str
    content: Optional[str]
    node_id: Union[int, str]
    summary: Optional[str]
    depth: int
    distance_from_target: int
    is_target: Optional[bool]
    is_search_target: Optional[bool]
    search_similarity: Optional[float]
    neighbor_of_target: Optional[bool]


class TraversalResult(TypedDict, total=False):
    """Type definition for traversal result nodes."""
    filename: str
    content: Optional[str]
    depth: int
    title: str
    node_id: str
    summary: Optional[str]
    is_target: Optional[bool]
    is_search_target: Optional[bool]
    search_similarity: Optional[float]
    neighbor_of_target: Optional[bool]
    distance_from_target: Optional[int]


class FilterResult(TypedDict, total=False):
    """Type definition for filtered node data."""
    filename: str
    title: str
    content: Optional[str]
    node_id: str
    summary: Optional[str]
    depth: int
    distance_from_target: int
    is_target: Optional[bool]
    is_search_target: Optional[bool]
    search_similarity: Optional[float]
    neighbor_of_target: Optional[bool]


class NodesGrouping(TypedDict):
    """Type definition for grouped nodes in accumulate_content."""
    targets: 'NodeList'
    parents: 'NodeList'
    children: 'NodeList'
    neighbors: 'NodeList'


# Vector store and embedding data structures
class VectorDocument(TypedDict):
    """Document structure for ChromaDB vector store."""
    metadata: dict[str, Any]
    document: Optional[str]


class ChromaQueryResult(TypedDict):
    """Result structure from ChromaDB queries."""
    ids: List[List[str]]
    distances: List[List[float]]
    metadatas: List[List[dict[str, Any]]]
    documents: List[List[Optional[str]]]


class ChromaGetResult(TypedDict):
    """Result structure from ChromaDB get operations."""
    ids: List[str]
    metadatas: List[dict[str, Any]]
    documents: List[Optional[str]]


class GeminiEmbeddingResult(TypedDict):
    """Result structure from Gemini embedding API."""
    embedding: List[float]


class EmbeddingRow(TypedDict):
    """Row structure for TSV embedding export."""
    node_id: int
    embedding: NDArray[Any]
    title: str
    summary: str
    filename: str


# Markdown parsing data structures
class ParentRelationship(TypedDict):
    """Parent relationship information extracted from Links section."""
    parent_filename: str
    relationship_type: str


class ChildRelationship(TypedDict):
    """Child relationship information extracted from Links section."""
    child_filename: str
    relationship_type: str


class ParsedRelationships(TypedDict):
    """All relationships parsed from the Links section."""
    parent: Optional[ParentRelationship]
    children: List[ChildRelationship]


class ParsedNode(TypedDict):
    """Complete parsed node data from markdown file."""
    node_id: Union[int, str]
    title: str
    summary: str
    content: str
    tags: List[str]
    created_at: datetime
    modified_at: datetime
    color: Optional[str]
    links: List[str]
    parent_info: Optional[ParentRelationship]
    filename: str


# Type aliases for common patterns
NodeDict = Union[NodeData, TraversalResult, FilterResult]
NodeList = List[NodeDict]


# String constants for dict keys to avoid string literals
class ParsedNodeKeys:
    """String constants for ParsedNode dictionary keys."""
    NODE_ID = "node_id"
    TITLE = "title"
    SUMMARY = "summary"
    CONTENT = "content"
    TAGS = "tags"
    CREATED_AT = "created_at"
    MODIFIED_AT = "modified_at"
    COLOR = "color"
    LINKS = "links"
    PARENT_INFO = "parent_info"
    FILENAME = "filename"


class RelationshipKeys:
    """String constants for relationship dictionary keys."""
    PARENT = "parent"
    CHILDREN = "children"
    PARENT_FILENAME = "parent_filename"
    CHILD_FILENAME = "child_filename"
    RELATIONSHIP_TYPE = "relationship_type"