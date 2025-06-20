"""
TADA Agent Definition - Tree Action Decider Agent

Sequential agent that processes voice transcripts through a 4-stage workflow:
Segmentation → Relationship Analysis → Integration Decision → Node Extraction

This is a pure agent definition using the clean architecture.
"""

from typing import List
from pathlib import Path
from ...core.base_agent import BaseAgent, AgentStage, AgentTransition, AgentType


class TADAAgent(BaseAgent):
    """
    Tree Action Decider Agent (TADA)
    
    Sequential agent that decides how to integrate new transcript content
    into the existing knowledge tree through a structured workflow.
    """
    
    def __init__(self):
        """Initialize TADA agent"""
        super().__init__(agent_id="tada", agent_type=AgentType.SEQUENTIAL)
    
    def _define_stages(self) -> List[AgentStage]:
        """Define the 4-stage TADA workflow"""
        return [
            AgentStage(
                id="segmentation",
                name="Transcript Segmentation",
                description="Break transcript into atomic idea chunks",
                prompt_file="segmentation.txt",
                input_keys=["transcript_text"],
                output_key="chunks",
                stage_type="segmentation"
            ),
            AgentStage(
                id="relationship_analysis",
                name="Relationship Analysis",
                description="Analyze relationships between chunks and existing nodes",
                prompt_file="relationship_analysis.txt",
                input_keys=["existing_nodes", "chunks"],
                output_key="analyzed_chunks",
                stage_type="relationship"
            ),
            AgentStage(
                id="integration_decision",
                name="Integration Decision",
                description="Decide whether to APPEND or CREATE for each chunk",
                prompt_file="integration_decision.txt",
                input_keys=["analyzed_chunks"],
                output_key="integration_decisions",
                stage_type="integration"
            ),
            AgentStage(
                id="node_extraction",
                name="Node Extraction",
                description="Extract new nodes to be created",
                prompt_file="node_extraction.txt",
                input_keys=["integration_decisions", "existing_nodes"],
                output_key="new_nodes",
                stage_type="extraction"
            )
        ]
    
    def _define_transitions(self) -> List[AgentTransition]:
        """Define the workflow transitions"""
        return [
            # Main sequential flow
            AgentTransition("segmentation", "relationship_analysis"),
            AgentTransition("relationship_analysis", "integration_decision"),
            AgentTransition("integration_decision", "node_extraction"),
            AgentTransition("node_extraction", "END"),
            
            # Error handling transitions
            AgentTransition("segmentation", "END", "error"),
            AgentTransition("relationship_analysis", "END", "error"),
            AgentTransition("integration_decision", "END", "error"),
            AgentTransition("node_extraction", "END", "error"),
            
            # Conditional transitions
            AgentTransition("segmentation", "END", "no_chunks"),
            AgentTransition("integration_decision", "END", "no_decisions")
        ]
    
    def _get_prompt_dir(self) -> Path:
        """Get the directory containing TADA prompts"""
        return Path(__file__).parent / "prompts" 