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

from backend.tree_manager.markdown_tree_ds import MarkdownTree, Node
from ..core.agent import Agent
from ..core.state import AppendToRelevantNodeAgentState
from ..models import (AppendAction, AppendAgentResult, CreateAction, SegmentationResponse, SegmentModel,
                      TargetNodeResponse, TargetNodeIdentification)
from backend.tree_manager.tree_functions import _format_nodes_for_prompt

class AppendToRelevantNodeAgent(Agent):
    """Agent that determines where to place new content in the tree"""
    
    def __init__(self):
        super().__init__("AppendToRelevantNodeAgent", AppendToRelevantNodeAgentState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Configure the two-prompt workflow"""
        # Step 1: Segment the text into atomic ideas
        self.add_prompt_node(
            "segmentation",
            SegmentationResponse,
            post_processor=self._segmentation_post_processor,
            model_name="gemini-2.5-flash-lite"
        )
        
        # Step 2: Identify target nodes for each segment
        self.add_prompt_node(
            "identify_target_node",
            TargetNodeResponse,
            model_name="gemini-2.5-flash"
        )
        
        # Use conditional edge to decide whether to identify target nodes
        self.add_conditional_dataflow(
            "segmentation", 
            self._route_after_segmentation,
            {
                "identify_target_node": "identify_target_node",
                "end": END
            }
        )
        self.add_dataflow("identify_target_node", END)
    
    def _segmentation_post_processor(self, state: Dict[str, Any], response: SegmentationResponse) -> Dict[str, Any]:
        """
        Post-processor for segmentation that populates the segments field with routable segments
        
        Args:
            state: Current state
            response: The SegmentationResponse from the LLM
            
        Returns:
            Updated state with segments field populated
        """
        import json
        
        # Extract routable segments
        routable_segments = [seg for seg in response.segments if seg.is_routable]
        
        # Prepare segments for target identification - only pass text field
        segments_for_target = [{"text": seg.edited_text} for seg in routable_segments]
        
        logging.info(f"Segmentation post-processor: {len(segments_for_target)} routable segments out of {len(response.segments)} total")
        
        # Update state with segments field
        state["segments"] = json.dumps(segments_for_target)
        return state
    
    
    def _route_after_segmentation(self, state: Dict[str, Any]) -> str:
        """
        Routing function to decide whether to proceed to target identification
        
        Returns:
            "identify_target_node" if there are routable segments
            "end" if no segments need routing
        """
        import json
        
        # Check the segments field populated by post-processor
        segments_json = state.get("segments", "[]")
        segments = json.loads(segments_json)
        
        if segments:
            logging.info(f"Found {len(segments)} routable segments, proceeding to target identification")
            return "identify_target_node"
        else:
            logging.warning("No routable segments found, skipping target identification")
            return "end"
    
    
    async def run(
        self,
        transcript_text: str,
        existing_nodes_formatted: str,
        transcript_history: str = ""
    ) -> AppendAgentResult:
        """
        Process text and return placement actions with segment information
        
        Args:
            transcript_text: Raw voice transcript to process
            existing_nodes_formatted: List of relevant nodes to consider for placement
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
            "segmentation_response": None,
            "identify_target_node_response": None,
            "current_stage": None,
            "debug_notes" : ""
        }

        # todo: pass in a shortened existing_nodes to the segement prompt
        # one which only includes the recently modfied nodes
        #
        
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
                    content=f"\n+++\n{segment.text}"
                ))
            else:
                # New node - create CreateAction (always orphan)
                actions.append(CreateAction(
                    action="CREATE",
                    parent_node_id=None,  # Always orphan nodes
                    new_node_name=segment.orphan_topic_name,
                    content=segment.text,
                    summary="",
                    relationship=""
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
    
