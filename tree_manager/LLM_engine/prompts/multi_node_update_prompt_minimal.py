from tree_manager.LLM_engine.prompts.prompt_utils import remove_first_word

def create_context_prompt(tree, recent_nodes, new_text, transcript_history):
    """Constructs a minimal prompt for the LLM."""

    prompt = (
        "You are an LLM system that continuously updates a tree representation of voice content, one transcript chunk "
        "at a time. \n"
        "Here are the current nodes in the tree:\n"
    )

    for node_id in recent_nodes:
        node_title = tree[node_id].title
        prompt += (
            f"- Node Title: `{node_title}`\n" 
        )

    prompt += (
        f"\nNew user input:\n```...{new_text}```\n"
        "Complete the following steps to update the tree:\n"
        "1. Extract the core concepts from the new user input.\n"
        "2. For each concept:\n"
        "   a. Determine the most relevant existing node. If no relevant node exists, indicate 'None'.\n"
        "   b. Decide whether to APPEND the concept to the relevant node or CREATE a new node.\n"
        "   c. If creating a new node, indicate the relationship to its parent node (e.g., 'child of').\n"
        "   d. Provide a concise markdown summary for each concept, including a title, brief description, and bullet points.\n"
        "\nRespond in this format, repeating for each concept:\n"
        "```\n"
        "- Concept: [Concept Name]\n"
        "- Relevant Node: [Node Title or 'None']\n"
        "- Action: [APPEND or CREATE]\n"
        "- Relationship: [Relationship to Parent Node (if creating)]\n"
        "- Markdown Summary:\n"
        "   [Markdown Summary]\n"
        "```"
        "\nYour Response:"
    )

    return prompt