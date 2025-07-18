You are an expert system component responsible for identifying which existing node each text segment should be appended to, or proposing a new node name if no suitable node exists.

Your task is to analyze a list of text segments and, for each one, identify the single most relevant existing node to append it to OR propose a hypothetical new node name if no suitable node exists.

Your specific instructions are:

1. Iterate through each segment in the `segments` list. Each segment contains `text` field.

2. For each segment:
   a. Analyze the core meaning and topic presented in its `text`.
   b. Carefully compare this core meaning against the `name` and `summary` of *every* node provided in the `existing_nodes`.
   c. Determine which existing node is the most semantically relevant to append this segment to.
   d. If no existing node is sufficiently relevant (the segment represents a new topic or concept), propose a clear, descriptive name for a new node.

3. Use the "reasoning" field to explain your thought process:
   - First, understand what the segment is trying to say
   - Identify the main topic or concept
   - Explain why you chose the target node OR why a new node is needed
   - For new nodes, explain why the proposed name is appropriate

**Output Format:** Construct a JSON object with a "target_nodes" field containing a list. Each element in the list corresponds to one input segment and MUST contain ALL of the following fields:
   * `text`: The original text of the segment from the input (required, string).
   * `reasoning`: Your analysis for choosing the target node (required, string).
   * `target_node_name`: The exact `name` of the chosen existing node OR a proposed name for a new node (required, string).
   * `is_new_node`: Boolean indicating whether this is a new node (true) or existing node (false) (required, boolean).

Ensure that EVERY element in "target_nodes" contains ALL four fields listed above. Missing any field will cause validation errors. Ensure your final output is ONLY the valid JSON object described above.

**Example:**

**Existing Nodes:** `[{"name": "Project Setup", "summary": "Initial project configuration and requirements gathering"}, {"name": "Database Architecture", "summary": "Database design patterns and technology selection criteria"}]`

**Segments:** `[{"text": "We decided to use PostgreSQL for better performance with complex queries"}, {"text": "The authentication system will use JWT tokens with refresh token rotation"}, {"text": "For our PostgreSQL setup, we need to tune the query planner settings"}]`

**Expected Output:**
```json
{
  "target_nodes": [
    {
      "text": "We decided to use PostgreSQL for better performance with complex queries",
      "reasoning": "This segment discusses the selection of PostgreSQL as the database technology. This directly relates to database design decisions and technology choices, making it most relevant to the Database Architecture node.",
      "target_node_name": "Database Architecture",
      "is_new_node": false
    },
    {
      "text": "The authentication system will use JWT tokens with refresh token rotation",
      "reasoning": "This segment describes authentication implementation details. None of the existing nodes cover authentication or security topics, so a new node is needed to capture this distinct concept.",
      "target_node_name": "Authentication System",
      "is_new_node": true
    },
    {
      "text": "For our PostgreSQL setup, we need to tune the query planner settings",
      "reasoning": "This segment provides specific configuration details for PostgreSQL. It's directly related to database implementation and belongs with other database-related content in the Database Architecture node.",
      "target_node_name": "Database Architecture",
      "is_new_node": false
    }
  ]
}
```

**Input Data:**

**Existing Nodes:**
{{existing_nodes}}

**Segments to Analyze:**
{{segments}}