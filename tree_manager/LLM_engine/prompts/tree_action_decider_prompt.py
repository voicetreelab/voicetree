def create_context_prompt(tree, recent_nodes, new_text, transcript_history, future_context="",
                          previous_iteration_input="", previous_iteration_output=""):
    """Constructs the prompt for the LLM to analyze context and update the visual tree structure."""

    prompt = (
        "You are an LLM-based system designed to convert live voice input into a structured visual tree.\n"
        "Your objective is to create an accurate, concise, and easily understandable representation of the spoken content.\n"
        "The tree should help the user grasp the overall logic, meaning, and relationships between concepts at a higher abstraction level.\n"
        "\n"
        "You achieve this by processing chunks of transcribed text and updating the tree's structure and content to reflect new information.\n"
        "\n"
    )
    prompt += (
        f"\nPrevious Iteration Input:\n```{previous_iteration_input}```\n"
        f"\nPrevious Iteration Output:\n```{previous_iteration_output}```\n"
    )

    prompt += (
        "Now, with the new input, follow this high-level algorithm:\n"
        "0. **Self-Adjustment**: Based on the quality of your previous output, you can make minor adjustments to the following steps to increase the quality. E.g modifying granularity, summarization, etc. methods in real-time based on the provided context.\n"   
        "0. **Integration with History**: Reference historical transcript and future lookahead context to understand the context of the chunk, avoid redundancy, & ensure outputs make sense in context.\n"
        "\n"
        "1. **Concept Extraction**: Identify all high-level concepts in the text chunk. Concepts may represent tasks, problems, options, states, etc.\n"
        "   - This way, each part of the text should be labelled with an associated concept name. There may be 1 or mroe concepts present in the chunk.  \n"
        "   - If the concept is highly similar to an existing node, use that as the concept_name, otherwise create a new short and concise name/title of the concept. "
        "   - Specify the neighbour node by identifying the most logical existing node, whose connection to the selected node would best reflect the meaning between these concepts within the context. "
        "       - Often the neighbour will be the most semantically similar/related concept, or an explicit relationship described within the text, or alternatively connected to a node created in previous iteration.   "
        "       -  avoid setting the root node as the neighbour, unless no alternative" 
        "   - Describe the relationship between the neighbour and selected node (e.g., ((neighbour) 'blocked by' (selected)).\n"
        "\n"
        "2. **Handling Incomplete Concepts**: If the last part of the text is incomplete or incoherent due to arbitrary chunk boundaries, do not assign it a concept yet, rather mark it as is_complete: false, all other fields can be left null except for transcript_extract"
        "   - This will often be the case for the last parts of the chunk. A future lookahead context sentence (like future history) will be provided to help you understand if the parts meamning will be significantly modified with the following sentence. \n"
        "   - For last iterations previously unfinished concepts, finalize them now. Set is_new_node: true and is_complete: true in this case. \n"
        "\n"
        "3. **Content Summarization**: For each concept, with reference to the text labelled with this concept (transcript_extract), generate:"
            "   - updated_summary_of_node: a short, dense, extremely concise (no pronouns, shortform, etc) summarization/abstract of the node content, up to 3 sentences, update summary_of_node if existing node. This acts as a node subtitle and is what is passed as input to you for each node.\n"
            "       - if the selected node already exists in the tree, update and extend its existing summary. \n"
            "   - markdown_content_to_append: concise markdown content, in the form of bullet points for details not obvious from the above updated_summary_of_node."
        "   - Together, these texts should accurately captures the meaning of the text extract labelled with that concept, within our context.\n"
        "\n"
        "\n"
        "\n"
        "Provide the output in the following JSON format:\n"
        "[ `for each concept` {\n"
        "'concept_name': \"<concept_name>\",\n"
        "'relevant_transcript_extract': \"<transcript_extract>\",\n"
        "'is_complete': true/false,\n"
        "'is_new_node': true/false,\n"
        "'markdown_content_to_append': \"<markdown_summary>\",\n"
        "'updated_summary_of_node': \"<updated_summary>\",\n" 
        "'neighbour_concept_name': \"<neighbour_concept_name>\"\n"
        "'relationship_to_neighbour': \"<relationship>\",\n"
        "}]\n"
        "\n"
        "INPUTS:\n\n"
        "Available tree nodes:\n"
    )

    # Ensure root is always in the list of recent nodes.
    if 0 not in recent_nodes:
        recent_nodes.append(0)

    for node_id in recent_nodes:
        node_summary = tree[node_id].summary
        node_content = tree[node_id].content
        node_title = tree[node_id].title
        prompt += (
            f"\nNode Title (concept_name): `{node_title}`\n"
            # f"Content length: {len(node_content)} characters\n"
            f"summary_of_node:\n```{node_summary}```\n"
        )

    # if transcript_history:
    #     prompt += (
    #         f"\nRecent conversation transcript to provide context:\n"
    #         f"```{transcript_history}...```\n"
    #         f"Note: The new input may relate to previous content or introduce new topics.\n"
    #     )

    prompt += f"\nText chunk to process:\n```{new_text}```\n"
    prompt += f"\nFuture context sentence:\n```{future_context}```\n"



    prompt += "Your JSON output:"

    return prompt
