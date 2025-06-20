from tree_manager.LLM_engine.prompts.prompt_utils import remove_first_word

def create_context_prompt(tree, recent_nodes, new_text, transcript_history):
    """Constructs the prompt for the LLM to analyze context."""

    also_summarize = True

    prompt = (
        "You are an LLM system which continuously updates a markdown tree representation of voice content."
        "You are given one transcript chunk, of a couple sentences at a time.\n"
        "The task is to decide where and how the voice transcript should be added to in a visual notes tree "
        "such that the updated tree best represents the speaker's content.\n"
        "First you will extract the concepts, and create a skeleton of the tree represented by the text chunk."
        "For each extracted concept. You can decide to either CREATE a new node, or APPEND to an existing node in the tree.\n"
        f"Here are the summaries of nodes {str(recent_nodes)} in a decision tree, "
        "ordered in descending order by the last time they were modified, so most recent first. "
        "Node length is also included.\n"
        f"Pay close attention to the meaning and intent of the new input within the context of the recent "
        f"conversation. Nodes:\n"
    )

    # ensure root is always in our list.
    if 0 not in recent_nodes:
        recent_nodes.append(0)

    for node_id in recent_nodes:
        node_summary = tree[node_id].summary
        node_content = tree[node_id].content
        node_title = tree[node_id].title
        prompt += (
            f"Node ID: {node_id}, Node Title: `{node_title}` Total content length: {len(node_content)}\n "
            f"Node {node_id} Summary:```{node_summary}```\n"
        )

    if len(transcript_history) > 2:
        prompt += (
            f"\nRecent conversation transcript to provide you context to the subsequent input:\n"
            f"```{transcript_history}...```\n"
            f"Do not assume that the new user input is relevant to the history,"
            f"it may be, but also the new user input may have switched to a completely different topic. "
        )

    prompt += f"\nNew user input:\n```...{new_text}```\n"

    prompt += """
    Think step-by-step to answer the following questions for EACH concept 
    identified in the new user input.  Ensure you always format your output 
    exactly as shown in the example: 

    1. **Concept:**  What is the concept or topic being discussed in this part of the transcript?

    2. **Relevant Node:** Which existing node is most relevant to this concept? 
       (Consider keyword matching, semantic similarity, and hierarchical relationships. 
       Respond with only the node title. If no relevant node, return 'None'.)

    3. **Action:** Should this concept be appended to the relevant node, or should a new node be created?
        (Respond with either "APPEND" or "CREATE".)

    4. **Relationship:** What is the relationship between this concept and the relevant node?
        (Choose ONE of the following: 'Child of', 'Parent of', 'Related to', 'Depends on', 
        'Prerequisite for', 'Clarification of', 'Example of'.)

    5. **Markdown Summary:** Provide a concise, short-form summary for this concept, avoiding redundancy 
       with the existing nodes AND the concept's title.
       Focus on the core information, rather than how the information was communicated.
       Format the summary in markdown, including:
       ## A concise title of up to 7 words
       **A brief summary of the new input, up to one paragraph in length.**
       - Bullet point(s) concisely representing key points and details not obvious from the above summary.
           - Optional sub-point(s)

    **Example Output (Repeat this format for EACH concept):**
    - Concept: [Concept Name]
    - Relevant Node: [Node Title]
    - Action: [CREATE | APPEND]
    - Relationship: [Chosen Relationship]
    - Markdown Summary:
    [markdown_summary]
    """

    prompt += (f"\nINPUT:"
               f"\nNew user input:\n```{new_text}```\n\n"
               f"Your response:\n")

    return prompt