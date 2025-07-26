"""
AppendToRelevantNodeAgent - Determines where to place new content in the tree

This agent:
1. Segments raw text into atomic ideas
2. Identifies target nodes or proposes new nodes for each segment
3. Returns AppendAction or CreateAction objects
"""

import logging
from typing import Any, Dict, List, Union

from langgraph.graph import END

from ...tree_manager.decision_tree_ds import DecisionTree, Node
from ..core.agent import Agent
from ..core.state import AppendToRelevantNodeAgentState
from ..models import (AppendAction, AppendAgentResult, CreateAction, SegmentationResponse, SegmentModel,
                      TargetNodeResponse, TargetNodeIdentification)
from ...tree_manager.tree_functions import _format_nodes_for_prompt

class AppendToRelevantNodeAgent(Agent):
    """Agent that determines where to place new content in the tree"""
    
    def __init__(self):
        super().__init__("AppendToRelevantNodeAgent", AppendToRelevantNodeAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Configure the two-prompt workflow"""
        # Step 1: Segment the text into atomic ideas
        self.add_prompt(
            "segmentation",
            SegmentationResponse
        )
        
        # Step 2: Identify target nodes for each segment
        self.add_prompt(
            "identify_target_node",
            TargetNodeResponse
        )
        
        # Define dataflow with filtering transform
        self.add_dataflow("segmentation", "identify_target_node", transform=self._prepare_for_target_identification)
        self.add_dataflow("identify_target_node", END)
    
    def _prepare_for_target_identification(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Transform state between segmentation and target identification"""
        logging.warning(f"Transform debug: state keys={list(state.keys())}")
        
        # Get segments from segmentation stage (now stored as typed object)
        segmentation_data: SegmentationResponse = state.get("segmentation_response")
        segments_data = segmentation_data.segments if segmentation_data else []
        
        logging.warning(f"Transform debug: segmentation_data={segmentation_data}, segments_data={len(segments_data) if segments_data else 0}")
        
        # Filter out incomplete segments - work with SegmentModel objects
        complete_segments = [seg for seg in segments_data if seg.is_routable]
        
        logging.warning(f"Transform debug: complete_segments={len(complete_segments)}")
        
        # If all segments are unfinished, skip target node identification
        if not complete_segments:
            logging.warning("No complete segments found, skipping target identification")
            return {
                **state,
                "segments": [],
                "target_nodes": []  # Set empty target_nodes to avoid LLM call
            }
        
        # Prepare segments for target identification - only pass text field
        segments_for_target = [{"text": seg.edited_text} for seg in complete_segments]
        
        logging.info(f"Transform debug: passing {len(segments_for_target)} segments to target identification")
        
        return {
            **state,
            "segments": segments_for_target  # Only complete segments for target identification
        }
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        existing_nodes_formatted: str,
        transcript_history: str = ""
    ) -> AppendAgentResult:
        """
        Process text and return placement actions with segment information
        
        Args:
            transcript_text: Raw voice transcript to process
            decision_tree: Current tree state
            existing_nodes: List of relevant nodes to consider for placement
            transcript_history: Optional context from previous transcripts
            
        Returns:
            AppendAgentResult containing actions and segment information
        """
        # Create initial state
        initial_state: AppendToRelevantNodeAgentState = {
            "transcript_text": transcript_text,
            "transcript_history": transcript_history,
            "existing_nodes": existing_nodes_formatted,
            "segments": None,
            "target_nodes": None,
            "_all_segments": None,
            "segmentation_response": None,
            "identify_target_node_response": None,
            "current_stage": None,
            "debug_notes" : ""
        }
        
        # Run the workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Get segments from segmentation stage (now stored as typed object)
        segmentation_data: SegmentationResponse = result.get("segmentation_response")
        all_segments_data = segmentation_data.segments if segmentation_data else []
        
        # Get target node identifications (now stored as typed object)
        target_nodes_data: TargetNodeResponse = result.get("identify_target_node_response")

        # Convert to actions - much simpler approach
        actions: List[Union[AppendAction, CreateAction]] = []
        if not target_nodes_data or not target_nodes_data.target_nodes:
            logging.warning("NO target NODES")
            return AppendAgentResult(actions=[], segments=[])

        # Process each routable segment with its corresponding target node
        for segment in target_nodes_data.target_nodes:
            # Create action based on target type
            if not segment.is_orphan:
                # Existing node - create AppendAction
                actions.append(AppendAction(
                    action="APPEND",
                    target_node_id=segment.target_node_id,
                    target_node_name=segment.target_node_name,
                    content=segment.text
                ))
            else:
                # New node - create CreateAction (always orphan)
                actions.append(CreateAction(
                    action="CREATE",
                    parent_node_id=None,  # Always orphan nodes
                    new_node_name=segment.orphan_topic_name,
                    content=segment.text,
                    summary=f"Content about {segment.orphan_topic_name}",
                    relationship="independent"
                ))
        
        # Log action names
        create_names = [action.new_node_name for action in actions if isinstance(action, CreateAction)]
        append_names = [action.target_node_name for action in actions if isinstance(action, AppendAction)]
        
        logging.info(f"Create actions for nodes: {create_names}")
        logging.info(f"Append actions for nodes: {append_names}")
        
        # Return segments directly (they're already SegmentModel objects)
        all_segments = all_segments_data
        
        return AppendAgentResult(
            actions=actions,
            segments=all_segments,
        )
    
