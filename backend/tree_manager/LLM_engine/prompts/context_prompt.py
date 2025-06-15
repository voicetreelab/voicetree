def create_context_prompt(tree, recent_nodes, text, transcript_history, future_history, prev_chunk, prev_output):
    """
    Creates a context prompt for the tree action decider LLM.
    
    Args:
        tree: The decision tree dictionary
        recent_nodes: List of recent node IDs  
        text: The input text to analyze
        transcript_history: Historical transcript context
        future_history: Future transcript context
        prev_chunk: Previous chunk of text processed
        prev_output: Previous output from the LLM
        
    Returns:
        str: The formatted prompt for the LLM
    """
    
    # Build context about existing nodes
    node_context = ""
    for node_id in recent_nodes:
        if node_id in tree:
            node = tree[node_id]
            node_context += f"- Node {node_id}: {node.title} - {node.summary}\n"
    
    if not node_context:
        node_context = "- No existing nodes to reference\n"
    
    return f"""
You are an expert at analyzing voice transcripts and organizing them into decision trees.

Your task is to analyze the given text and decide whether to:
1. CREATE new nodes for new concepts/topics
2. APPEND to existing nodes for related content

Current tree context:
{node_context}

Previous chunk processed: {prev_chunk}
Previous output: {prev_output}

Transcript history: {transcript_history}
Future context: {future_history}

Current text to analyze: {text}

Please analyze this text and return a JSON array of actions. Each action should have:
- "relevant_transcript_extract": The specific part of the transcript this action relates to
- "is_new_node": true for CREATE, false for APPEND
- "concept_name": Name of the concept/node
- "neighbour_concept_name": Name of the related node (for CREATE actions)
- "relationship_to_neighbour": How this relates to the neighbour (e.g., "child of", "relates to")
- "updated_summary_of_node": Summary of the node after this action
- "markdown_content_to_append": The content to add to the node
- "is_complete": true if this action is complete, false if more processing needed

Example response:
[
    {{
        "relevant_transcript_extract": "We need to plan the marketing campaign",
        "is_new_node": true,
        "concept_name": "Marketing Campaign Planning",
        "neighbour_concept_name": "Root",
        "relationship_to_neighbour": "child of",
        "updated_summary_of_node": "Planning activities for the marketing campaign",
        "markdown_content_to_append": "## Marketing Campaign Planning\\n\\n**Planning activities for the marketing campaign**\\n\\n- Define target audience\\n- Set budget constraints",
        "is_complete": true
    }}
]

Please provide your response as a valid JSON array:
""" 