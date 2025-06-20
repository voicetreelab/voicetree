import logging

from backend.settings import LLMTask
from backend.agentic_workflows.infrastructure.llm_integration import call_llm
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.utils import extract_summary


class Rewriter:
    async def rewrite_node_in_background(self, decision_tree: DecisionTree, node_id: int):
        """Rewrites the given node in the background."""
        content = decision_tree.tree[node_id].content
        transcript_history = decision_tree.tree[node_id].transcript_history
        rewritten_content = await self._rewrite_node(content, transcript_history)

        decision_tree.tree[node_id].content = rewritten_content
        if node_id != 0:  # don't rewrite the root node (todo correct?)
            decision_tree.tree[node_id].summary = extract_summary(rewritten_content)

    async def _rewrite_node(self, node_content: str, context: str = None) -> str:
        """
        Rewrites a given node's content using an LLM, aiming to improve clarity,
        conciseness, and structure.

        Args:
            node_content (str): The original content of the node.
            context (str, optional): Contextual information to aid the rewriting process.
                                      Defaults to None.

        Returns:
            str: The rewritten node content.
        """

        node_content = node_content.replace("#", "")
        # todo: mention that transcript history won't include new user content
        # todo, include siblings.

        # todo, could we also re-write siblings??!!

        # todo explain why the nodes become messy
        prompt = f"""
        Instructions:
        I have a system which summarizes and appends voice transcript to the most relevant node in a content tree.
        Over time the nodes become long, disorganized and inconcise.
        - Rewrite the following node content to improve its readability, remove redundancies, 
          and ensure it's well-organized. Ensure it is maximally concise.
        - I will also include the raw transcript that was originally used to create the node content.
          Ensure all the core information is still represented in the rewrite. 
        - Use Markdown formatting to structure the content, 
           include a short title, a one paragraph summary of the whole node
           and then bullet points of the content matter divided up by sections
        - merge sections where possible to minimize the number of sections to maximise conciseness
        - Return output like so:\n
        ## short_title 
        ** summary of node content **

        #### section_n_title
        - bullet point content
            - indented sub-point
        - ...
        ...
        """

        # prompt += f"Contextual Information:\n```\n{context}\n```\n" if context else ''}

        prompt += f"""

        Here is the raw transcript input for the node:\n
        {context}

        Here is the original node content:\n
        {node_content}

        Rewritten node content: 
        """

        logging.info(f"background resumm prompt: {prompt}")

        try:
            response = call_llm(prompt)
            return response.strip()
        except Exception as e:
            logging.error(f"Error during node rewriting: {e}")
            return node_content
