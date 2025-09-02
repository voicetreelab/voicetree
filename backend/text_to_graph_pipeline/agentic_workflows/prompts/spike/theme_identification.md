# Theme Identification

You are an expert in identifying high-level themes and concepts from a collection of notes. Your task is to analyze the provided nodes from a tree structure and group them into a specified number of coherent themes.

## Input Data

You will be given a list of nodes, each with an ID, a title, and a summary.

**Actual Nodes to Analyze:**
```
{{formatted_nodes}}
```

## Task

1.  **Analyze the Nodes:** Carefully read the title and summary of each node to understand its content and purpose.
2.  **Identify Themes:** Based on your analysis, identify {{num_themes}} distinct themes that capture the main topics or concepts present in the nodes.
3.  **Group Nodes:** Assign each node to one of the themes you identified by listing their exact titles.
4.  **Describe Themes:** For each theme, provide a descriptive name and a brief summary.
5.  **Confidence Score:** For each theme, provide a confidence score between 0.0 and 1.0, representing how confident you are in the coherence and accuracy of the theme.

## CRITICAL INSTRUCTIONS

**IMPORTANT:** 
- When grouping nodes, you MUST use the EXACT node titles as shown in the input above. 
- DO NOT use node IDs.
- DO NOT invent or modify node titles.
- Copy the node titles EXACTLY as they appear, including any numbers in parentheses.
- Every node name you provide MUST match one of the titles from the "Actual Nodes to Analyze" section above.
- If no nodes clearly fit a theme, leave the node_names list empty for that theme.

## Output Format

Your output must be a JSON object that validates against the following Pydantic model:

```python
class Theme(BaseModel):
    """A single theme identified from the nodes."""
    theme_name: str = Field(description="A short, descriptive name for the theme.")
    theme_description: str = Field(description="A brief description of the theme.")
    node_names: List[str] = Field(description="A list of node titles/names belonging to this theme. Use the exact node titles as shown.")
    confidence: float = Field(description="Confidence score for the theme identification.", ge=0.0, le=1.0)

class ThemeResponse(BaseModel):
    """Response model for theme identification analysis"""
    themes: List[Theme] = Field(description="List of identified themes.")
```

## Example Structure (NOT real data):

The following is just to show the JSON structure. DO NOT use these theme names or node names. Use ONLY the actual node titles from the input above.

```json
{
  "themes": [
    {
      "theme_name": "<A theme name based on the actual nodes>",
      "theme_description": "<A description based on the actual nodes>",
      "node_names": ["<exact title from input>", "<another exact title from input>"],
      "confidence": 0.85
    }
  ]
}
```

Remember: Only use node titles that actually exist in the "Actual Nodes to Analyze" section. Do not make up node names.