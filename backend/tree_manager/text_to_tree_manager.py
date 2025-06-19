import logging
import asyncio
from typing import Set

import google.generativeai as genai

import sys
import os

# Add project root to Python path for imports
current_file = os.path.abspath(__file__)
backend_dir = os.path.dirname(os.path.dirname(current_file))
project_root = os.path.dirname(backend_dir)

# Add both project root and backend to path to handle all import scenarios
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Now import settings - this should work from any directory
import settings

from backend.tree_manager.future.base import TreeManagerInterface, TreeManagerMixin
from .LLM_engine.background_rewrite import Rewriter
from .LLM_engine.summarize_with_llm import Summarizer
from .LLM_engine.tree_action_decider import Decider
from .decision_tree_ds import DecisionTree
from .utils import remove_first_word, extract_complete_sentences

# Import NodeAction from within module to avoid circular import
from collections import namedtuple

NodeAction = namedtuple('NodeAction',
                        [
                            'labelled_text',
                            'action',
                            'concept_name',
                            'neighbour_concept_name',
                            'relationship_to_neighbour',
                            'updated_summary_of_node',
                            'markdown_content_to_append',
                            'is_complete'
                        ])

genai.configure(api_key=settings.GOOGLE_API_KEY)


class ContextualTreeManager(TreeManagerInterface, TreeManagerMixin):
    def __init__(self, decision_tree: DecisionTree):
        self.decision_tree: DecisionTree = decision_tree
        self.text_buffer: str = ""
        self.transcript_history: str = ""
        self.transcript_history_up_until_curr = ""
        self.future_lookahead_history = ""
        self.text_buffer_size_threshold: int = settings.TEXT_BUFFER_SIZE_THRESHOLD
        self._nodes_to_update: Set[int] = set()  # Use private attribute for interface property
        self.summarizer = Summarizer()
        self.decider = Decider()
        self.rewriter = Rewriter()
        self._first_processing = True  # Track if this is the first processing

    async def process_voice_input(self, transcribed_text: str):
        """
        Processes incoming transcribed text, appends to buffers,
        and triggers text chunk processing when the buffer reaches
        the threshold. Only processes complete sentences.

        Args:
            transcribed_text (str): The transcribed text from the
                                   speech recognition engine.
        """
        self.text_buffer += transcribed_text + " "
        self.transcript_history += transcribed_text + " "

        # Extract complete sentences from the text buffer
        text_to_process = extract_complete_sentences(self.text_buffer)
        logging.info(f"text_to_process: '{text_to_process}' from text_buffer: '{self.text_buffer}'")

        # Update the transcript history to maintain a window of relevant context
        self.transcript_history = self.transcript_history[
                                  -self.text_buffer_size_threshold * (settings.TRANSCRIPT_HISTORY_MULTIPLIER + 1):]

        # Determine the point at which to split text for lookahead
        # Only do lookahead splitting if there are multiple sentences
        if text_to_process.count('.') + text_to_process.count('!') + text_to_process.count('?') > 1:
            length_of_last_dot = text_to_process[:-1].rfind('.') + 1
            length_of_last_q = text_to_process[:-1].rfind('?') + 1
            length_of_last_exc = text_to_process[:-1].rfind('!') + 1
            # todo just use a regex
            length_of_last_sentence = max(length_of_last_q, length_of_last_exc, length_of_last_dot)

            # The portion before the split point is the main text to process
            text_to_process = text_to_process[:length_of_last_sentence]
            logging.info(f"text_to_process after lookahead split: '{text_to_process}'")

        # The portion after the split point is the future lookahead context
        self.future_lookahead_history = self.text_buffer[len(text_to_process):] if len(text_to_process) > 0 else self.text_buffer

        # Update the transcript history up until the current point (excluding lookahead)
        self.transcript_history_up_until_curr = remove_first_word(self.transcript_history)[:-len(self.text_buffer)]

        logging.info(f"Text buffer size is now {len(self.text_buffer)} characters")
        logging.info(f"Text to process size is now {len(text_to_process)} characters")
        logging.info(f"Future lookahead size is now {len(self.future_lookahead_history)} characters")

        # Process if either we have complete sentences that exceed threshold, 
        # OR if the buffer itself exceeds threshold (even with incomplete sentences)
        should_process = (len(text_to_process) > self.text_buffer_size_threshold) or \
                        (len(self.text_buffer) > self.text_buffer_size_threshold and len(text_to_process) == 0)
        
        if should_process:
            # If we don't have complete sentences but buffer is large, process the buffer as-is
            if len(text_to_process) == 0 and len(self.text_buffer) > self.text_buffer_size_threshold:
                text_to_process = self.text_buffer.strip()
                self.future_lookahead_history = ""
            
            logging.info(f"Processing text chunk as criteria met. Final text_to_process: '{text_to_process}'")
            # if(get_num_req_last_min >= 15):
            #     return
            # num_req_last_min += 2 (no put this in the actual llm call)

            await self._process_text_chunk(text_to_process, self.transcript_history_up_until_curr)
            self.text_buffer = self.text_buffer[len(text_to_process):]  # Clear processed text

            # processed text doesn't include whitespace, so after clearing it may contain just whitespace
            if len(self.text_buffer) < 2:
                self.text_buffer = self.text_buffer.strip()
                # todo: this is a hacky way handle edge case of where there is leftover in text_Buffer, now not ending on a space

    async def _process_text_chunk(self, text_chunk: str, transcript_history_context: str):
        """
        Processes a text chunk, summarizes and analyzes it using LLMs,
        and updates the decision tree accordingly.

        Args:
            text_chunk (str): The chunk of text to process.
            transcript_history_context (str): The relevant portion of the
                                            transcript history for context.
        """

        # Add root node to updates on first processing to ensure it gets a markdown file
        if self._first_processing:
            self._nodes_to_update.add(0)  # Add root node
            self._first_processing = False

        # Call decide_tree_action with the previous chunk and output for context
        actions = await self.decider.decide_tree_action(
            self.decision_tree, text_chunk, transcript_history_context, self.future_lookahead_history
        )

        # Process each action returned by the decider
        for node_action in actions:
            node_action: NodeAction
            if not node_action.is_complete:
                continue  # todo have seperate buffer for incomplete nodes
            if node_action.action == "CREATE":
                parent_node_id = self.decision_tree.get_node_id_from_name(node_action.neighbour_concept_name)
                new_node_id: int = self.decision_tree.create_new_node(
                    name=node_action.concept_name,
                    parent_node_id=parent_node_id,
                    content=node_action.markdown_content_to_append,
                    summary=node_action.updated_summary_of_node,
                    relationship_to_parent=node_action.relationship_to_neighbour
                )
                self._nodes_to_update.add(new_node_id)

            elif node_action.action == "APPEND":
                chosen_node_id = self.decision_tree.get_node_id_from_name(node_action.concept_name)
                await self._append_to_node(chosen_node_id, node_action.markdown_content_to_append,
                                           node_action.updated_summary_of_node, node_action.labelled_text)

                self._nodes_to_update.add(chosen_node_id)

            else:
                print("Warning: Unexpected mode returned from decide_tree_action")

            # Add the chosen node ID to the list of nodes to update


    async def _append_to_node(self, chosen_node_id, content, summary, text_chunk):
        self.decision_tree.tree[chosen_node_id].append_content(content, summary, text_chunk)

        # only do this every nth time, because append is fine for a couple times before it gets messy
        if self.decision_tree.tree[chosen_node_id].num_appends % settings.BACKGROUND_REWRITE_EVERY_N_APPEND == 0:
            asyncio.create_task(
                self.rewriter.rewrite_node_in_background(self.decision_tree, chosen_node_id)).add_done_callback(
                lambda res: self._nodes_to_update.add(chosen_node_id))
