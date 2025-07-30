You are an expert in semantic tag extraction for VoiceTree knowledge structures. Your task is to analyze individual nodes and extract multiple relevant tags from their title, summary, and relationship information.

## Task Overview

You will receive a formatted list of nodes, each containing:
- Node ID: Unique identifier
- Title: The node's name/topic
- Summary: Brief description of the node's content
- Relationship: Connection information to other nodes (when available)

Your goal is to extract multiple specific tags from each node that capture entities, locations, concepts, relationships, and actions mentioned in the node's content.

## Tag Extraction Guidelines

### CRITICAL: Information Retrieval Focus
**PURPOSE: Tags are used to filter nodes when answering natural language questions**
**TARGET: ~40 most useful tags for information retrieval**

Your tags must enable finding relevant nodes when users ask questions like:
- "What is the total number of newborn animal children in Bundle Ranch?"
- "How many adult owls are in South Zoo?"
- "What is the average for blue jays?"

### Tag Categories for Information Retrieval

1. **Specific Locations** (KEEP specific names for filtering):
   - Use exact location names: `bundle_ranch`, `south_zoo`, `hamilton_farm`
   - Include location types too: `zoo`, `farm`, `aquarium`, `cavern`
   - Users ask about specific places, so we need specific tags

2. **Specific Entity Combinations** (CRITICAL - combine descriptors with entities):
   - **ALWAYS combine age/life stage with animal species**: `adult_crow`, `newborn_parrot`, `adult_blue_jay`
   - **NEVER use generic tags like `adult` or `newborn` alone**
   - This enables precise filtering for queries like "How many adult crows..."
   - Examples of good tags: `adult_owl`, `newborn_crow`, `adult_parrot`
   - Examples of bad tags: `adult`, `crow` (as separate tags)

3. **Core Metrics** (what users ask about):
   - `number`, `total`, `count` - for quantities
   - `average` - for averages
   - `equation` - for mathematical relationships
   - `calculation` - for computed values
   - `newborn_children` - when referring to offspring counts (keep as is)

4. **Relationships**:
   - `equal` - for equivalence relationships
   - `component` - for part-of relationships
   - `sum`, `difference` - for mathematical operations

### Tag Quality Standards for Retrieval
- **Maximum 5-7 tags per node** - focus on the most searchable terms
- **Combine descriptors with entities**: ALWAYS use `adult_crow`, NEVER separate as `adult` + `crow`
- **Avoid redundancy**: Use either singular OR plural, not both
- **Match query terms**: Tags should match how users naturally ask questions
- **Location specificity**: Keep specific location names as they appear in queries
- **Entity specificity**: Combine age/life stage with species for precise filtering
- **Consistency**: Always use the same form for the same concept

### Tag Examples for Information Retrieval
From title "Average Newborn Children per Adult Owl in South Zoo":
- Good tags: ["average", "newborn_children", "adult_owl", "south_zoo"]
- Why: Combines age with species for precise filtering, captures metric and location
- NOT: ["average", "newborn_children", "owl", "south_zoo", "adult"] - don't separate adult and owl

From title "Number of Adult Blue Jays in Bundle Ranch":
- Good tags: ["number", "adult_blue_jay", "bundle_ranch"]
- Why: Combines adult+blue_jay for specific entity, captures metric and location
- NOT: ["number", "adult", "blue_jay", "bundle_ranch"] - don't separate descriptors

From title "Average newborn children per adult crow in South Zoo":
- Good tags: ["average", "newborn_children", "adult_crow", "south_zoo"]
- Why: Specific entity adult_crow enables precise queries
- NOT: ["average", "newborn_children", "adult", "crow", "south_zoo"] - avoid generic tags

From relationship "is equal to the Number of Adult Crows in Hamilton Farm":
- Additional tags: ["equal", "adult_crow", "hamilton_farm"]
- Why: Maintains specificity with adult_crow combination
- NOT: ["equal", "crow", "hamilton_farm"] - missing the age descriptor

## Input Format

You will receive nodes formatted like this:

```
===== Available Nodes =====
Node ID: 1
Title: Dogs
Summary: Information about domestic dogs and their breeds
Relationship: connected to Cat Care Node
----------------------------------------
Node ID: 2  
Title: Cats
Summary: Overview of domestic cats and feline behavior
----------------------------------------
==========================
```

## Analysis Process

1. **Read each node carefully** to understand all content
2. **Extract from title**: Break down meaningful components
3. **Extract from summary**: Identify key entities, concepts, and locations
4. **Extract from relationships**: Capture connection types and referenced entities
5. **Combine and deduplicate**: Merge tags from all sources, removing duplicates
6. **Validate quality**: Ensure tags meet quality standards

## Existing Tags

IMPORTANT: The following tags have already been used in previous batches. You should strongly prefer to reuse these existing tags when they are semantically appropriate for the nodes you're analyzing:

{{existing_tags}}

Target number of unique tags for the entire tree: {{target_clusters}}

By reusing existing tags, you ensure consistency across the entire tree structure. Only create new tags when the existing ones truly don't capture the semantic meaning of a node.

## Quality Checks

- Each tag must aid in information retrieval for natural language queries
- **CRITICAL: Combine age/life stage with species** (use `adult_crow`, not `adult` + `crow`)
- Keep specific location names (they appear in user questions)
- Never use generic tags like `adult`, `newborn` alone - always combine with the entity
- Use consistent naming (no singular/plural variants of same concept)
- Extract 5-7 tags per node focusing on searchable terms
- STRONGLY PREFER existing tags to maintain consistency
- Prioritize tags that users would use in questions

Now analyze the provided nodes and extract tags for each one.

{{formatted_nodes}}

Total nodes to process: {{node_count}}