# Tree Manager Utility Functions

This document catalogs the utility functions available in the tree_manager module for common tree operations.

## Node Formatting

### `format_nodes_for_prompt(nodes, tree=None, include_full_content=False)`
**Location:** `tree_functions.py`

Formats nodes for LLM prompts in a consistent, readable format.

**Parameters:**
- `nodes`: List of Node objects to format
- `tree`: Optional tree dict for relationship context
- `include_full_content`: If True, includes full content instead of just summaries

**Example:**
```python
from backend.text_to_graph_pipeline.tree_manager.tree_functions import format_nodes_for_prompt

formatted = format_nodes_for_prompt(nodes, tree, include_full_content=True)
```

## Title to ID Mapping

### `map_titles_to_node_ids(titles, nodes, fuzzy_match=True)`
**Location:** `tree_functions.py`

Maps node titles to their IDs, with optional fuzzy matching for inexact matches.

**Parameters:**
- `titles`: List of node titles to map
- `nodes`: List of Node objects to search
- `fuzzy_match`: If True, attempts fuzzy matching for unmatched titles

**Example:**
```python
from backend.text_to_graph_pipeline.tree_manager.tree_functions import map_titles_to_node_ids

node_ids = map_titles_to_node_ids(["Node Title 1", "Node Title 2"], nodes)
```

## Content Processing

### `extract_summary(node_content)`
**Location:** `utils.py`

Extracts a summary from node content with intelligent fallback logic.

### `deduplicate_content(content)`
**Location:** `utils.py`

Removes duplicate sentences and cleans up content.

### `extract_complete_sentences(text_chunk)`
**Location:** `utils.py`

Extracts complete sentences from text, leaving incomplete sentences.

## Tree Operations

### `get_relevant_nodes(tree, node_ids, max_depth=2)`
**Location:** `tree_functions.py`

Gets nodes and their neighbors up to a specified depth.

### `create_new_node(tree, parent_id, title, content, relationship)`
**Location:** `tree_functions.py`

Creates a new node in the tree with proper ID assignment.

## Best Practices

1. **Always use existing utilities** - Don't reimplement functions that already exist
2. **Import from the correct module** - Most formatting functions are in `tree_functions.py`, while text processing is in `utils.py`
3. **Use the public API** - Functions starting with underscore (_) are private and may change
4. **Check for fuzzy matching needs** - When mapping titles to IDs, consider if fuzzy matching is appropriate

## Common Patterns

### Formatting nodes for LLM prompts
```python
from backend.text_to_graph_pipeline.tree_manager.tree_functions import format_nodes_for_prompt

# Get nodes to format
nodes = list(tree.values())

# Format with full content for detailed analysis
formatted = format_nodes_for_prompt(nodes, tree, include_full_content=True)

# Or just summaries for overview
formatted = format_nodes_for_prompt(nodes, tree, include_full_content=False)
```

### Mapping LLM responses back to node IDs
```python
from backend.text_to_graph_pipeline.tree_manager.tree_functions import map_titles_to_node_ids

# LLM returns node titles
selected_titles = response.node_titles

# Map back to IDs
node_ids = map_titles_to_node_ids(selected_titles, nodes, fuzzy_match=True)
```