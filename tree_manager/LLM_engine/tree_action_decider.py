import json
import logging
import time
import traceback
from collections import namedtuple
from typing import Tuple, List
import re
import settings
from tree_manager import NodeAction
from tree_manager.LLM_engine.LLM_API import generate_async
from tree_manager.LLM_engine.prompts.tree_action_decider_prompt import create_context_prompt
from tree_manager.decision_tree_ds import DecisionTree


class Decider:
    def __init__(self):
        self._prev_chunk = ""
        self._prev_output = ""

    async def decide_tree_action(self, decision_tree: DecisionTree, text: str,
                                 transcript_history: str, future_history: str,
                                 ) -> list[tuple[str, str, int, str]]:
        """
        Analyzes the context of the given text using an LLM to
        determine whether to create new nodes or append to existing ones.

        Args:
            decision_tree: The DecisionTree object.
            text (str): The input text to analyze.
            transcript_history (str): The transcript history for context.
            prev_chunk (str): The previous chunk of text processed.
            prev_output (str): The previous output from the LLM.

        Returns:
            list[tuple[str, str, int, str]]: A list of tuples, each containing:
                                                - the mode ("CREATE" or "APPEND")
                                                - the relationship
                                                - the chosen node ID
                                                - the summary
                                                :param future_history:
        """

        response_text = ""
        actions = []

        try:
            prev_chunk = self.get_prev_chunk()
            prev_output = self.get_prev_output()
            recent_nodes: List[int] = decision_tree.get_recent_nodes(num_nodes=settings.NUM_RECENT_NODES_INCLUDE)

            prompt: str = create_context_prompt(decision_tree.tree,
                                                recent_nodes,
                                                text,
                                                transcript_history,
                                                future_history,
                                                prev_chunk,
                                                prev_output)

            response_text = await generate_async(settings.LLMTask.CLASSIFY, prompt)
            response_text = response_text.strip()

            # Update the decision tree with the latest chunk and output for the next iteration
            self.update_prev_chunk(text)
            self.update_prev_output(response_text)  # Store the actions as a string

            # Assuming the response is a list of dictionaries
            extracted_concepts = json.loads(response_text)

            # Iterate through each concept
            for concept in extracted_concepts:
                try:
                    labelled_text = concept['relevant_transcript_extract']
                    action = "CREATE" if concept['is_new_node'] else "APPEND"
                    concept_name = concept["concept_name"]
                    chosen_neighbour = concept['neighbour_concept_name']
                    relationship = concept['relationship_to_neighbour']
                    summary = concept['updated_summary_of_node']
                    content = concept['markdown_content_to_append']
                    is_complete = concept['is_complete']

                    actions.append(
                        NodeAction(labelled_text,
                                   action,
                                   concept_name,
                                   chosen_neighbour,
                                   relationship,
                                   summary,
                                   content,
                                   is_complete))
                except (ValueError, IndexError, KeyError, AttributeError, Exception) as e:
                    logging.error(f"Error processing concept: {concept}")
                    logging.warning(
                        f"Warning: Could not extract information from concept: {e} - Response: {response_text} "
                        f"- Type: {type(e)} - Traceback: {traceback.format_exc()}"
                    )
                    actions.append(
                        ("CREATE", "Unknown Relationship", 0, f"## Unknown Content\n **{e}**\n {response_text}"))

            return actions

        except (ValueError, IndexError, AttributeError, Exception) as e:
            logging.error(f"Tree state: {decision_tree.tree}")
            logging.warning(
                f"Warning: Could not process LLM response: {e} - Response: {response_text} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}"
            )
            return [("CREATE", "Unknown Relationship", 0, f"## Unknown Content\n **{e}**\n {response_text}")]

    def get_prev_chunk(self) -> str:
        """Returns the previous text chunk processed."""
        return self._prev_chunk

    def get_prev_output(self) -> str:
        """Returns the previous output from the LLM."""
        return self._prev_output

    def update_prev_chunk(self, text_chunk: str):
        """Updates the previous text chunk processed."""
        self._prev_chunk = text_chunk

    def update_prev_output(self, output: str):
        """Updates the previous output from the LLM."""
        self._prev_output = output
