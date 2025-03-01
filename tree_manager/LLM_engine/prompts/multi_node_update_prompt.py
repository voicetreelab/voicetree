from tree_manager.LLM_engine.prompts.prompt_utils import remove_first_word

def create_context_prompt(tree, recent_nodes, new_text, transcript_history):
    """Constructs the prompt for the LLM to analyze context and support multi-node updates."""

    also_summarize = True

    prompt = (
        "The task is to decide where a voice transcript should be added to in a visual notes tree"
        "such that the updated tree best represents the speaker's content\n"
        "You can decide to either CREATE a new node, or APPEND to an existing node in the tree.\n"
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
        prompt += (f"Node ID: {node_id}, Node Title: `{node_title}` Total content length: {len(node_content)}\n "
                   f"Node {node_id} Summary:```{node_summary}```\n")

    if len(transcript_history) > 2:
        prompt += (f"\nRecent conversation transcript to provide you context to the subsequent input:\n"
                   f"```{transcript_history}...```\n"
                   f"Do not assume that the new user input is relevant to the history,"
                   f"it may be, but also the new user input may have switched to a completely different topic. "
                   )

    prompt += f"\nNew user input:\n```...{new_text}```\n"

    prompt += """
    First, identify all distinct concepts or topics present in the new user input. These could be tasks, decisions, problems, or specific features discussed.

    Then, for each concept identified, perform the following:

    1. **Concept:** [Concept Name]
    2. **Which node is the most relevant to this concept?** (Respond with only the node ID, if no relevant node, return 0 as default).
    3. **Should this concept be appended to the most relevant node or is it a new idea that should be created as a new node?** (Respond with either "APPEND" or "CREATE").
    4. **How would you best explain the relationship between this concept and the most relevant node?** Explain in up to five words as the discovered_relationship.
    """

    if also_summarize:
        prompt += """
    5. **Provide a concise, short-form summary for this concept, avoiding redundancy with the existing nodes i.e you don't have to mention things that are obvious from it's neighbouring nodes.**
       Focus on the core information, rather than how the information was communicated, such as style or pronouns.
       formatted in markdown, including:
       ## A concise title of up to 7 words\n
       **A brief summary of the new input, up to one paragraph in length.**\n
       - bullet point(s) concisely representing key points and details not obvious from the above summary.
           - optional sub-point(s)\n\n
       Save this as markdown_summary
    """

    prompt += """
    Instructions for deciding whether to append or create:
    - CREATE a new node if the new input introduces a distinct idea or task, or a clearly delineated sub-concept or sub-task.
    - CREATE a new node if the new user input has a relationship that resembles a dependency, prerequisite, or requirement
      to the most relevant node (i.e., it is something that must be completed before the existing node can proceed).
    - APPEND if the new user input is directly related to the most relevant node 
      with no clear separating relationship or conceptual difference.
    - APPEND if the new user input corrects, clarifies, expands upon or otherwise ammends the relevant node
    - APPEND if there is no clear concept being discussed, heavy informal language, vague, or if there is otherwise not sufficient content to form an individual node
    """

    prompt += """
    Provide your answer in the following format for EACH concept:
    - First spend up to 5 sentences brainstorming your answer, giving yourself time to think.
    - Concept: [Concept Name]
    - Node ID: [node_id]
    - Action: [CREATE | APPEND]
    - Relationship: [discovered_relationship]
    """

    if also_summarize:
        prompt += """
    - Markdown Summary: 
    [markdown_summary]
        """

    prompt += (f"\nINPUT:"
               f"\nNew user input:\n```{new_text}```\n\n"
               f"Your response:\n")


    return prompt