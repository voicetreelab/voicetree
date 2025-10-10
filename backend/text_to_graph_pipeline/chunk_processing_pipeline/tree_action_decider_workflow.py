"""
TreeActionDeciderWorkflow - Orchestrates the two-step tree update pipeline with workflow result handling.

Combines the functionality of TreeActionDecider and WorkflowAdapter into a single cohesive class.
"""

import logging
from dataclasses import dataclass
from itertools import groupby
from typing import Any
from typing import Optional

from termcolor import colored

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    _format_nodes_for_prompt,
)
from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.sync_markdown_to_tree import sync_nodes_from_markdown
from backend.settings import MAX_NODES_FOR_LLM_CONTEXT
from backend.settings import TRANSCRIPT_HISTORY_MULTIPLIER
from backend.text_to_graph_pipeline.agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
    ConnectOrphansAgent,
)
from backend.text_to_graph_pipeline.agentic_workflows.agents.single_abstraction_optimizer_agent import (
    SingleAbstractionOptimizerAgent,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAgentResult
from backend.text_to_graph_pipeline.agentic_workflows.models import BaseTreeAction
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager
from backend.text_to_graph_pipeline.text_buffer_manager.history_manager import (
    HistoryManager,
)


@dataclass
class WorkflowResult:
    """Result from workflow execution"""
    success: bool
    new_nodes: list[str]
    tree_actions: list[BaseTreeAction]
    error_message: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


async def log_tree_actions(append_or_create_actions):
    for act in append_or_create_actions:
        if isinstance(act, CreateAction):
            create_log = f"CREATING new node:'{act.new_node_name}' "
            # if len(act.content) > 10:
                # create_log += f"with text: {act.content[0:10]}...{act.content[-10:]} "
            print(colored(create_log, 'green'))
            logging.info(create_log)

        elif isinstance(act, AppendAction):
            append_log = f"APPENDING to:'{act.target_node_name}' "
            # if len(act.content) > 10:
                # append_log += f"with text: {act.content[0:10]}...{act.content[-10:]} "
            print(colored(append_log, 'cyan'))
            logging.info(append_log)

        else:
            logging.error(f"ERROR, ACTION NEITHER CREATE NOR APPEND: {act}")


class TreeActionDeciderWorkflow:
    """
    Orchestrates the two-step tree update pipeline with workflow result handling.
    NOT an agent - pure deterministic coordination with result wrapping.
    """

    def __init__(
        self,
        decision_tree: Optional[MarkdownTree] = None,
        cloud_function_url: str | None = None
    ) -> None:
        """
        Initialize the workflow

        Args:
            decision_tree: Optional decision tree instance (can be set later)
            cloud_function_url: URL of the Cloud Function (default: localhost:8080)
        """
        import os
        self.decision_tree: Optional[MarkdownTree] = decision_tree

        # Use provided URL, env var, or default to localhost
        if cloud_function_url is None:
            cloud_function_url = os.environ.get(
                "CLOUD_FUNCTION_URL",
                "http://localhost:8080"
            )

        from cloud_functions.agentic_workflows.http_client import AppendToRelevantNodeAgentHTTPClient
        # self.append_agent = AppendToRelevantNodeAgentHTTPClient(cloud_function_url)

        self.append_agent: AppendToRelevantNodeAgent = AppendToRelevantNodeAgent()

        self.optimizer_agent: SingleAbstractionOptimizerAgent = SingleAbstractionOptimizerAgent()
        self.connect_orphans_agent: ConnectOrphansAgent = ConnectOrphansAgent()
        self.nodes_to_update: set[int] = set()

        # Initialize history manager
        self._history_manager = HistoryManager()

        # Track previous buffer remainder to detect stuck text
        self._prev_buffer_remainder: str = ""  # What was left in buffer after last processing

        self.content_stuck_in_buffer: dict[str, Any] = {}

        # Track when to run orphan connection (every 10-20 nodes)
        self._last_orphan_check_node_count: int = 0
        self._orphan_check_interval: int = 15  # Check every 15 nodes

    def get_workflow_statistics(self) -> dict[str, Any]:
        """Get statistics about the workflow state"""
        if not self.decision_tree:
            return {"error": "No decision tree set"}

        return {
            "total_nodes": len(self.decision_tree.tree),
            "message": "Workflow is stateless - showing tree statistics"
        }

    def clear_workflow_state(self) -> None:
        """Clear the workflow state"""
        # Clear stuck text tracking
        self._prev_buffer_remainder = ""
        # Clear history
        self._history_manager.clear()

    def get_transcript_history(self, max_length: Optional[int] = None) -> str:
        """Get transcript history with optional length limit"""
        return self._history_manager.get(max_length)

    async def run(
        self,
        transcript_text: str,
        decision_tree: MarkdownTree,
        transcript_history: str = ""
    ) -> list[BaseTreeAction]:
        # TODO WE SHOULD REMOVE THIS, WE SHOULD NEVER HAVE BACKWARDS COMPATABILITY
        """
        Wrapper method for backwards compatibility with tests.
        Runs the workflow and returns all optimization actions.

        Args:
            transcript_text: The text to process
            decision_tree: The decision tree to update
            transcript_history: Historical context

        Returns:
            List of optimization actions that were applied
        """
        # Set the decision tree
        self.decision_tree = decision_tree

        # Create temporary instances for the wrapper
        from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager
        buffer_manager = TextBufferManager()
        tree_action_applier = TreeActionApplier(decision_tree)

        # Store optimization actions for test compatibility
        self.optimization_actions_for_tests: list[BaseTreeAction] = []

        # Process the chunk
        await self.process_text_chunk(
            text_chunk=transcript_text,
            tree_action_applier=tree_action_applier,
            buffer_manager=buffer_manager
        )

        # Return the optimization actions for test compatibility
        return self.optimization_actions_for_tests

    async def process_text_chunk(
        self,
        text_chunk: str,
        tree_action_applier: TreeActionApplier,
        buffer_manager: TextBufferManager
    ) -> set[int]:
        """
        Processes a text chunk through a single, deep, stateful workflow.
        This method directly applies actions in a two-phase process to the instance's
        decision tree, enabling a "Progressive Refinement" user experience.

        Args:
            text_chunk: The chunk of text to process.
            tree_action_applier: The TreeActionApplier instance to use for applying actions.
            buffer_manager: The TextBufferManager instance for buffer operations.

        Returns:
            Set of node IDs that were updated
        """
        logging.info(f"Buffer full, Starting stateful workflow for text chunk ( {(text_chunk)}, of length {len(text_chunk)})")
        print(f"Buffer full, sending to agentic workflow, text: {text_chunk}\n")

        self.nodes_to_update.clear()

        # Track merged orphan actions
        self.merged_orphan_actions: list[CreateAction] = []

        # ======================================================================
        # PHASE 1: PLACEMENT (APPEND/CREATE)
        # ======================================================================
        logging.info("Running Phase 1: Placement Agent...")

        # Get the most relevant nodes for the agent to consider
        if self.decision_tree is None:
            raise ValueError("Decision tree is not initialized")
        relevant_nodes = get_most_relevant_nodes(self.decision_tree, MAX_NODES_FOR_LLM_CONTEXT, query=text_chunk)
        relevant_nodes_formatted = _format_nodes_for_prompt(relevant_nodes, self.decision_tree.tree)

        # Get transcript history from our own history manager
        transcript_history = self.get_transcript_history()

        # The append_agent now returns both actions and segment information
        append_agent_result: AppendAgentResult = await self.append_agent.run(
            transcript_text=text_chunk,
            existing_nodes_formatted=relevant_nodes_formatted,
            transcript_history=transcript_history
        )
        logging.info(f"append_agent_results, {len(append_agent_result.actions)} "
                     f"actions: {append_agent_result}")

        append_or_create_actions: list[AppendAction | CreateAction] = append_agent_result.actions

        # FOR EACH COMPLETED SEGMENT, REMOVE FROM BUFFER AND UPDATE HISTORY
        # note, you ABSOLUTELY HAVE TO do this per segment, not all at once for all completed text.
        max_history = buffer_manager.bufferFlushLength * TRANSCRIPT_HISTORY_MULTIPLIER
        for segment in append_agent_result.segments:
            if segment.is_routable:
                buffer_manager.flushCompletelyProcessedText(segment.raw_text)
                # Update history with the routed segment
                self._history_manager.append(segment.raw_text, max_history)

        # to avoid possible bugs with stuck text (never gets processed)
        await self.clear_text_that_has_been_not_cleared_for_multiple_iterations(buffer_manager)

        # --- Orphan Merging ---
        # This logic is necessary before the first apply.
        # Merge all create actions into a single node,
        # ONLY FOR THE NODES THAT HAVE THE SAME TOPIC NAME
        # so that they can be seperated by optimizer.
        # Process actions based on orphan merge logic
        actions_to_apply: list[BaseTreeAction] = append_or_create_actions

        # todo, we should move this logic into append_agent
        actions_to_apply = await self.group_orphans_by_name(actions_to_apply, append_or_create_actions)

        # Log actions AFTER orphan merging to avoid duplicates
        await log_tree_actions(actions_to_apply)

        # --- SYNC MARKDOWN BEFORE APPLYING ACTIONS ---
        # Identify which nodes will be modified by Phase 1 actions
        nodes_to_sync_before_phase1: set[int] = set()
        for action in actions_to_apply:
            if isinstance(action, (AppendAction, UpdateAction)):
                # These actions modify existing nodes
                node_id = action.target_node_id if isinstance(action, AppendAction) else action.node_id
                nodes_to_sync_before_phase1.add(node_id)

        # Sync markdown content back to tree BEFORE applying Phase 1 actions
        # This ensures manual edits to markdown files are preserved
        if nodes_to_sync_before_phase1:
            logging.info(f"Syncing {len(nodes_to_sync_before_phase1)} nodes from markdown BEFORE Phase 1 actions")
            sync_nodes_from_markdown(self.decision_tree, nodes_to_sync_before_phase1)

        # --- First Side Effect: Apply Placement ---
        modified_or_new_nodes = tree_action_applier.apply(actions_to_apply)
        logging.info(f"Phase 1 Complete. Nodes affected: {modified_or_new_nodes}")

        # Separate newly created nodes from modified nodes
        newly_created_nodes: set[int] = set()
        modified_nodes: set[int] = set()
        merged_orphan_node_ids: set[int] = set()

        for action in actions_to_apply:
            if isinstance(action, CreateAction):
                # The created node ID will be in modified_or_new_nodes
                # We need to find it by matching the node name
                for node_id in modified_or_new_nodes:
                    if self.decision_tree is not None and node_id in self.decision_tree.tree and self.decision_tree.tree[node_id].title == action.new_node_name:
                        newly_created_nodes.add(node_id)
                        # Check if this was a merged orphan
                        if action in self.merged_orphan_actions:
                            merged_orphan_node_ids.add(node_id)
                        break
            elif isinstance(action, AppendAction):
                # AppendAction modifies existing nodes
                if action.target_node_id in modified_or_new_nodes:
                    modified_nodes.add(action.target_node_id)

        logging.info(f"Phase 1 Complete. Newly created nodes: {newly_created_nodes}, Modified nodes: {modified_nodes}, Merged orphan nodes: {merged_orphan_node_ids}")

        # ======================================================================
        # PHASE 2: OPTIMIZATION
        # ======================================================================
        logging.info("Running Phase 2: Optimization Agent...")

        # Combine modified nodes and merged orphan nodes for optimization
        nodes_to_optimize = modified_nodes.union(merged_orphan_node_ids)
        logging.info(f"Optimizing {len(modified_nodes)} modified nodes and {len(merged_orphan_node_ids)} merged orphan nodes")

        # Run optimizer on both modified nodes and merged orphan nodes
        all_optimization_modified_nodes: set[int] = set()
        for node_id in nodes_to_optimize:
            node_type = "merged orphan" if node_id in merged_orphan_node_ids else "modified"
            logging.info(f"Optimizing {node_type} node {node_id}...")

            # Get neighbors, remove 'id' key, and format as a string for the agent
            if self.decision_tree is None:
                raise ValueError("Decision tree is not initialized")
            neighbours_context = self.decision_tree.get_neighbors(node_id, max_neighbours=30)
            formatted_neighbours_context = str([
                {key: value for key, value in neighbour.items() if key != 'id'}
                for neighbour in neighbours_context
            ]) #todo, ugly. This is just to remove IDs.

            # The optimizer runs on the tree which has ALREADY been mutated by Phase 1.
            optimization_actions: list[BaseTreeAction] = await self.optimizer_agent.run(
                node=self.decision_tree.tree[node_id],
                neighbours_context=formatted_neighbours_context
            )

            if optimization_actions:
                logging.info(f"Optimizer generated {len(optimization_actions)} actions for node {node_id}. Applying them now.")

                # Log each optimization action
                for opt_action in optimization_actions:
                    if isinstance(opt_action, UpdateAction):
                        update_log = f"OPTIMIZER: UPDATING node:{opt_action.node_id} "
                        # if len(opt_action.new_content) > 10:
                        #     update_log += f"with new content: {opt_action.new_content[0:10]}...{opt_action.new_content[-10:]} "
                        print(update_log)
                        logging.info(update_log)

                    elif isinstance(opt_action, CreateAction):
                        create_log = f"OPTIMIZER: CREATING child node:'{opt_action.new_node_name}' under parent:{opt_action.parent_node_id} "
                        # if len(opt_action.content) > 10:
                        #     create_log += f"with content: {opt_action.content[0:10]}...{opt_action.content[-10:]} "
                        print(colored(create_log, 'green'))
                        logging.info(create_log)

                    elif isinstance(opt_action, AppendAction):
                        append_log = f"OPTIMIZER: APPENDING to node:{opt_action.target_node_id} "
                        # if len(opt_action.content) > 10:
                        #     append_log += f"with content: {opt_action.content[0:10]}...{opt_action.content[-10:]} "
                        print(colored(append_log, 'cyan'))
                        logging.info(append_log)

                    else:
                        logging.warning(f"Unknown optimization action type: {type(opt_action)}")

                # --- Second Side Effect: Apply Optimization ---
                # Apply these actions immediately.
                optimization_modified_nodes: set[int] = tree_action_applier.apply(optimization_actions)
                all_optimization_modified_nodes.update(optimization_modified_nodes)

                # Collect optimization actions for test compatibility
                if hasattr(self, 'optimization_actions_for_tests'):
                    self.optimization_actions_for_tests.extend(optimization_actions)

            else:
                logging.info(f"Optimizer had no changes for node {node_id}.")

        # Always store current buffer state for next processing to detect stuck text
        self._prev_buffer_remainder = buffer_manager.getBuffer() #todo what's this for?


        # todo, new code, haven't extensively tested this yet
        # ======================================================================
        # PHASE 3: CONNECT ORPHANS (Every N nodes)
        # ======================================================================
        if self.decision_tree is None:
            raise ValueError("Decision tree is not initialized")
        current_node_count = len(self.decision_tree.tree)
        nodes_added_since_last_check = current_node_count - self._last_orphan_check_node_count

        if nodes_added_since_last_check >= self._orphan_check_interval:
            logging.info(f"Running Phase 3: Connect Orphans Agent (tree has {current_node_count} nodes)...")

            try:
                # Run the connection agent to group orphan nodes
                connection_actions, parent_child_mapping = await self.connect_orphans_agent.run(
                    tree=self.decision_tree,
                    max_roots_to_process=20
                )

                if connection_actions:
                    logging.info(f"Connect Orphans Agent created {len(connection_actions)} parent nodes")

                    # Apply the connection actions
                    connection_modified_nodes = tree_action_applier.apply(connection_actions)
                    all_optimization_modified_nodes.update(connection_modified_nodes)

                    logging.info(f"Connected orphan subtrees with new parent nodes: {connection_modified_nodes}")
                else:
                    logging.info("No obvious groupings found among orphan nodes")

                # Update the last check count
                self._last_orphan_check_node_count = current_node_count

            except Exception as e:
                logging.error(f"Error in Connect Orphans phase: {e}")
                # Don't fail the whole workflow, just log the error

        # Return the set of all affected nodes (new + modified + optimization-modified)
        return modified_or_new_nodes.union(all_optimization_modified_nodes)

    async def group_orphans_by_name(self, actions_to_apply, append_or_create_actions):
        orphan_creates: list[CreateAction] = [
            action for action in append_or_create_actions
            if isinstance(action, CreateAction) and not action.parent_node_id
        ]

        # Clear the tracked merged orphans
        self.merged_orphan_actions = []

        if len(orphan_creates) > 1:
            # Sort orphans by name for groupby
            sorted_orphans = sorted(orphan_creates, key=lambda x: x.new_node_name)

            # Group orphan nodes by name
            orphan_groups = groupby(sorted_orphans, key=lambda x: x.new_node_name)

            # Get non-orphan actions
            non_orphan_actions: list[BaseTreeAction] = [
                action for action in append_or_create_actions
                if not (isinstance(action, CreateAction) and action.parent_node_id is None)
            ]

            # Process each group
            merged_orphans: list[CreateAction] = []
            for name, orphans_iter in orphan_groups:
                orphans = list(orphans_iter)  # Convert iterator to list

                if len(orphans) > 1:
                    logging.info(f"Merging {len(orphans)} orphan nodes with name '{name}'")

                    # Merge orphans with same name using list comprehensions
                    merged_orphan: CreateAction = CreateAction(
                        action="CREATE",
                        parent_node_id=None,
                        new_node_name=name,  # Use the common name
                        content="\n\n".join(orphan.content for orphan in orphans),
                        summary="\n\n".join(orphan.summary for orphan in orphans if orphan.summary),
                        relationship=""  # Empty for orphan nodes
                    )
                    merged_orphans.append(merged_orphan)
                    # Track this as a merged orphan that needs optimization
                    self.merged_orphan_actions.append(merged_orphan)
                else:
                    # Single orphan, add as-is
                    merged_orphans.extend(orphans)

            # Replace all orphan creates with the merged ones
            actions_to_apply = non_orphan_actions + merged_orphans
        return actions_to_apply

    async def clear_text_that_has_been_not_cleared_for_multiple_iterations(self, buffer_manager):
        # increment stuck texts
        to_remove = []
        for stuck_text, stuck_count in self.content_stuck_in_buffer.items():
            if stuck_text in buffer_manager.getBuffer():
                if stuck_count >= 4:  # already been in buffer 4 times! it's stuck
                    buffer_manager.flushCompletelyProcessedText(stuck_text)
                    to_remove.append(stuck_text)
                else:
                    self.content_stuck_in_buffer[stuck_text] += 1
        # remove stuck texts (to not change iterator while iterating)
        for text in to_remove:
            self.content_stuck_in_buffer.pop(text)
        # set stuck text
        if buffer_manager.getBuffer() not in self.content_stuck_in_buffer:
            self.content_stuck_in_buffer[buffer_manager.getBuffer()] = 1
