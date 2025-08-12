# Connect Orphan Nodes Prompt

You are analyzing a tree structure that has multiple disconnected components (orphan subtrees).
Your task is to identify which disconnected root nodes share obvious relationships and should
be grouped under a common parent node.

## Context

You are given root nodes from disconnected subtrees. Each root represents the top of an 
independent component in the tree. Your goal is to find natural groupings where multiple
roots clearly relate to each other through a common theme, category, or concept.

## Root Nodes to Analyze

{roots_context}

## Instructions

1. **Analyze Relationships**: Look at the titles and summaries of all root nodes. Identify
   which roots share obvious thematic, conceptual, or categorical relationships.

2. **Form Groupings**: Group at least {min_group_size} related roots together ONLY if there
   is a clear and obvious relationship. Do not force unrelated topics together.

3. **Create Parent Nodes**: For each grouping, define:
   - A clear, descriptive title for the parent node that captures the common theme
   - A summary that explains what unites these subtrees
   - The relationship type (e.g., "is_a_category_of", "is_a_theme_grouping_of")

## Important Constraints

- **Only group roots with OBVIOUS relationships**: If roots don't clearly relate, leave them ungrouped
- **Minimum group size**: Each grouping must contain at least {min_group_size} root nodes
- **Avoid over-grouping**: Don't create overly broad parent categories just to connect everything
- **Preserve independence**: Some roots may remain disconnected if they truly represent independent topics

## Examples of Good Groupings

**Example 1**: Roots about "User Authentication", "Password Management", and "Session Handling"
→ Parent: "Security and Authentication System"

**Example 2**: Roots about "React Components", "Vue Templates", and "Angular Directives"  
→ Parent: "Frontend Framework Components"

**Example 3**: Roots about "Database Queries", "SQL Optimization", and "Index Management"
→ Parent: "Database Performance and Management"

## Examples of Poor Groupings (Avoid These)

**Bad Example 1**: Grouping "User Authentication" with "Color Themes" 
→ Too unrelated, no clear connection

**Bad Example 2**: Creating parent "System Stuff" for any technical topics
→ Too vague and broad

**Bad Example 3**: Forcing all roots under "Application Features"
→ Over-grouping loses meaningful structure

Remember: It's better to leave roots disconnected than to create forced, artificial groupings.