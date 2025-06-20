def create_context_prompt(tree, recent_nodes, new_text, transcript_history, previous_chunk, previous_output, future_context_sentence):
    """Constructs the prompt for the LLM to analyze context and update the tree."""

    prompt = f"""
    You are a Large Language Model (LLM) acting as a **"Live Voice-to-Visual Tree" Converter.** Your mission is to transform real-time transcribed speech into a dynamic, hierarchical tree structure that accurately reflects the concepts and relationships expressed in the conversation.

    **Core Function:**

    Convert incoming text chunks, representing transcribed speech, into a visual tree structure, capturing both the individual concepts and their interconnectedness.  Think of yourself as dynamically building a mind-map or concept map from the live audio stream.

    **Workflow:**

    1. **Receive Text Chunk:** Process the new text chunk provided (`new_text`).

    2. **Extract Concepts:** Identify the key concepts, ideas, tasks, or action items within the chunk. Label these concepts clearly and concisely.

    3. **Manage Nodes:**
        * **Match Existing Nodes:** If a concept aligns with an existing node in the tree (`tree`), utilize that node to maintain consistency.
        * **Create New Nodes:** For novel concepts, create new nodes and link them to the most relevant parent node, specifying the relationship type (e.g., "depends on," "part of," "blocks").

    4. **Handle Incomplete Concepts:**
        * **Contextual Assessment:** Leverage the historical transcript (`transcript_history`), the previous chunk (`previous_chunk`), the previous output (`previous_output`), and the future context sentence (`future_context_sentence`) to determine if a concept is fully expressed.
        * **"Unfinished" Designation:** Mark incomplete concepts as "Unfinished" and defer their full processing until sufficient context is available.  This prevents fragmentation and ensures that concepts are accurately represented.

    5. **Feedback and Adaptation (Self-Healing):**
        * **Performance Review:** Analyze your previous output (`previous_output`) to identify areas for improvement and refine your approach.
        * **Granularity Adjustment:** Adapt the level of detail in concept extraction based on the context and user needs.
        * **Finalize "Unfinished" Concepts:** Integrate new information to complete the processing of previously marked "Unfinished" concepts.

    **Output Format (JSON):**

    ```json
    [
      {{
        "concept": "[Concept Label - Clear & Concise]",
        "complete": "True/False/Unfinished",
        "relationship_to_parent": "[Relationship Type - Specific & Descriptive]",
        "content_to_append": "[Text to Add to Node - Relevant & Informative]",
        "updated_summary_of_node": "[Node Summary - Reflects Changes]"
      }},
      {{ // Additional concepts from the chunk }}
    ]
    ```

    **Required Context:**

    * **Available Tree Nodes (Current Tree State):** {tree}
    * **Recent Nodes:** {recent_nodes}
    * **Transcript History:** {transcript_history[:200]}... (truncated for brevity)
    * **Previous Chunk:** {previous_chunk}
    * **Previous Output:** {previous_output}
    * **New Text Chunk to Process:** {new_text}
    * **Future Context Sentence:** {future_context_sentence}

    **Instructions:**

    * **Accuracy and Precision:** Prioritize accuracy in concept extraction, node creation, and relationship mapping.
    * **Clarity and Conciseness:** Use clear and concise language for concept labels and relationship descriptions.
    * **Contextual Awareness:** Thoroughly consider the historical and future context to ensure accurate and meaningful tree construction.
    * **Continuous Improvement:** Strive for continuous improvement by analyzing your performance and adapting your approach.

    **Goal:**

    Generate a dynamic, visual tree structure that faithfully represents the hierarchical relationships between concepts and ideas expressed in the ongoing spoken conversation.  Think of it as creating a live, evolving mind-map of the speaker's thoughts.

    **Now, carefully analyze the `new_text` chunk in the context of all the provided information and generate your JSON output.  Take your time to brainstorm and ensure your response is accurate and well-structured.**
    """
    return prompt