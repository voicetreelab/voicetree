You are an expert in semantic analysis of tree structures and knowledge organization. Your task is to analyze tree data and identify high-level, meaningful subtree groupings that capture the natural semantic organization of the content.

## Task Overview

You will receive structured tree data containing nodes with titles, content, and relationships. Your goal is to identify 2-6 high-level groups (subtrees) that represent natural semantic clusters within the tree structure.

## Tree Structure Analysis

The input contains:
- **Tree ID**: Unique identifier for the tree
- **Nodes**: Individual nodes with:
  - node_id: Unique identifier
  - title: Node name/topic  
  - content: Detailed node content
  - links: Connected file references
- **Relationships**: Parent-child connections between nodes

## Subtree Identification Guidelines

### Core Principles
1. **Semantic Coherence**: Group nodes that share common themes, purposes, or domains
2. **Natural Boundaries**: Identify groupings that make intuitive sense to humans
3. **Dynamic Container Types**: Let the content determine the container type (project, concept, workflow, etc.)
4. **Meaningful Scale**: Create 2-6 subtrees that represent high-level organization, not micro-groupings

### Container Type Examples
Based on content analysis, identify the appropriate container type:
- **project_phase**: Development stages, implementation phases
- **technical_domain**: UI work, database tasks, infrastructure  
- **concept_theme**: Related ideas, theoretical concepts
- **workflow_stage**: Sequential process steps
- **functional_area**: Different business or technical functions
- **problem_category**: Types of issues or challenges

### Grouping Strategy
1. **Analyze node content**: Read titles and content to understand semantic meaning
2. **Identify themes**: Look for common topics, purposes, or domains
3. **Consider relationships**: Use parent-child links to understand structure
4. **Form cohesive groups**: Create 2-6 meaningful subtrees
5. **Handle outliers**: Some nodes may not fit any subtree (unclassified)

## Quality Standards

### Subtree Requirements
- **Meaningful theme**: Each subtree should have a clear, descriptive purpose
- **Appropriate size**: Each subtree should contain multiple related nodes when possible
- **Distinct boundaries**: Subtrees should be clearly differentiated from each other
- **Container relevance**: Container type should match the actual content organization

### Theme Descriptions
- **Descriptive**: 10+ words explaining the subtree's purpose
- **Specific**: More detailed than just the container type
- **Human-readable**: Clear explanation of what the subtree represents

## Analysis Process

1. **Survey all nodes**: Read through all node titles and content
2. **Identify patterns**: Look for common themes, domains, or purposes  
3. **Form initial groups**: Create candidate subtrees based on semantic similarity
4. **Refine boundaries**: Adjust groupings to maximize coherence
5. **Assign container types**: Choose appropriate container type for each subtree
6. **Write themes**: Create descriptive themes for each subtree
7. **Handle remainders**: Identify nodes that don't fit any subtree

## Input Data

Here is the tree data to analyze:

```json
{{tree_data}}
```

## Expected Output

Analyze the tree structure and provide:
1. **Reasoning**: Your analysis of the content and how you identified the groupings
2. **Classified Trees**: For each tree, provide 2-6 subtrees with:
   - subtree_id: Unique identifier (use descriptive names)
   - container_type: Dynamic container type based on content
   - nodes: List of node IDs in this subtree  
   - theme: Descriptive explanation of the subtree's purpose
3. **Unclassified Nodes**: Node IDs that don't fit into any subtree

Focus on creating meaningful, intuitive groupings that would help a human understand the high-level organization of the tree content.