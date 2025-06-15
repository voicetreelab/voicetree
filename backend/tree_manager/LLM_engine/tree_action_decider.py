import json
import logging
import traceback
from typing import List, Dict, Any
from backend import settings
from backend.tree_manager import NodeAction
from backend.agentic_workflows.infrastructure.llm_integration import call_llm
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.LLM_engine.prompts import create_context_prompt


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

            response_text = call_llm(prompt)
            response_text = response_text.strip()

            # Update the decision tree with the latest chunk and output for the next iteration
            self.update_prev_chunk(text)
            self.update_prev_output(response_text)  # Store the actions as a string

            # Extract JSON from response (handles markdown code fences)
            clean_json = self._extract_json_from_response(response_text)
            extracted_concepts = json.loads(clean_json)

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
                        NodeAction(labelled_text="Unknown",
                                   action="CREATE",
                                   concept_name="Unknown Concept",
                                   neighbour_concept_name="Unknown Neighbour", 
                                   relationship_to_neighbour="Unknown Relationship",
                                   updated_summary_of_node=f"## Unknown Content\n **{e}**\n {response_text}",
                                   markdown_content_to_append="",
                                   is_complete=False))

            return actions

        except (ValueError, IndexError, AttributeError, Exception) as e:
            logging.error(f"Tree state: {decision_tree.tree}")
            logging.warning(
                f"Warning: Could not process LLM response: {e} - Response: {response_text} "
                f"- Type: {type(e)} - Traceback: {traceback.format_exc()}"
            )
            return [NodeAction(labelled_text="Unknown",
                                 action="CREATE",
                                 concept_name="Unknown Concept",
                                 neighbour_concept_name="Unknown Neighbour",
                                 relationship_to_neighbour="Unknown Relationship",
                                 updated_summary_of_node=f"## Unknown Content\n **{e}**\n {response_text}",
                                 markdown_content_to_append="",
                                 is_complete=True
                                 )]

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

    def _extract_existing_nodes_info(self, decision_tree) -> str:
        """Extract readable information about existing nodes"""
        if not decision_tree.tree or len(decision_tree.tree) <= 1:
            return "No existing nodes (empty tree)"
        
        node_info = []
        for node_id, node in decision_tree.tree.items():
            if node_id == 0:  # Skip root node for cleaner output
                continue
            
            parent_name = "Root" if node.parent_id == 0 else decision_tree.tree.get(node.parent_id, {}).get('name', 'Unknown')
            node_info.append(f"- **{node.name}** (child of {parent_name}): {node.summary or node.content[:100] + '...' if node.content else 'No content'}")
        
        return "\n".join(node_info) if node_info else "No non-root nodes"
