"""
TROA Agent Definition - Tree Reorganization Agent

Background agent that continuously optimizes the knowledge tree structure.
Analyzes tree patterns and performs reorganization operations.

This is a pure agent definition using the clean architecture.
"""

from typing import List
from pathlib import Path
from ...core.base_agent import BaseAgent, AgentStage, AgentTransition, AgentType


class TROAAgent(BaseAgent):
    """
    Tree Reorganization Agent (TROA)
    
    Background agent that continuously optimizes the knowledge tree structure
    by analyzing patterns and performing reorganization operations.
    """
    
    def __init__(self):
        """Initialize TROA agent"""
        super().__init__(agent_id="troa", agent_type=AgentType.BACKGROUND)
    
    def _define_stages(self) -> List[AgentStage]:
        """Define the TROA workflow stages"""
        return [
            AgentStage(
                id="tree_analysis",
                name="Tree Structure Analysis",
                description="Analyze current tree structure for optimization opportunities",
                prompt_file="tree_analysis.txt",
                input_keys=["tree_snapshot", "recent_transcript"],
                output_key="analysis_results",
                stage_type="processing"
            ),
            AgentStage(
                id="optimization_planning",
                name="Optimization Planning",
                description="Plan specific optimizations based on analysis",
                prompt_file="optimization_planning.txt",
                input_keys=["analysis_results", "tree_snapshot"],
                output_key="optimization_plan",
                stage_type="decision"
            ),
            AgentStage(
                id="merge_detection",
                name="Merge Candidate Detection",
                description="Identify nodes that should be merged together",
                prompt_file="merge_detection.txt",
                input_keys=["tree_snapshot"],
                output_key="merge_candidates",
                stage_type="processing"
            ),
            AgentStage(
                id="split_detection", 
                name="Split Candidate Detection",
                description="Identify nodes that should be split into multiple nodes",
                prompt_file="split_detection.txt",
                input_keys=["tree_snapshot"],
                output_key="split_candidates",
                stage_type="processing"
            ),
            AgentStage(
                id="relationship_optimization",
                name="Relationship Optimization",
                description="Optimize parent-child relationships in the tree",
                prompt_file="relationship_optimization.txt",
                input_keys=["tree_snapshot", "analysis_results"],
                output_key="relationship_improvements",
                stage_type="processing"
            ),
            AgentStage(
                id="reorganization_execution",
                name="Execute Reorganization",
                description="Apply the planned optimizations to the tree",
                prompt_file="reorganization_execution.txt",
                input_keys=["optimization_plan", "merge_candidates", "split_candidates", "relationship_improvements"],
                output_key="reorganization_results",
                stage_type="output"
            )
        ]
    
    def _define_transitions(self) -> List[AgentTransition]:
        """Define the TROA workflow transitions"""
        return [
            # Main analysis flow
            AgentTransition("tree_analysis", "optimization_planning"),
            AgentTransition("optimization_planning", "merge_detection"),
            AgentTransition("merge_detection", "split_detection"),
            AgentTransition("split_detection", "relationship_optimization"),
            AgentTransition("relationship_optimization", "reorganization_execution"),
            AgentTransition("reorganization_execution", "END"),
            
            # Error handling
            AgentTransition("tree_analysis", "END", "error"),
            AgentTransition("optimization_planning", "END", "error"),
            AgentTransition("merge_detection", "END", "error"),
            AgentTransition("split_detection", "END", "error"),
            AgentTransition("relationship_optimization", "END", "error"),
            AgentTransition("reorganization_execution", "END", "error"),
            
            # Conditional flows
            AgentTransition("tree_analysis", "END", "no_optimization_needed"),
            AgentTransition("optimization_planning", "END", "no_changes_required"),
            AgentTransition("merge_detection", "split_detection", "no_merges_found"),
            AgentTransition("split_detection", "relationship_optimization", "no_splits_found")
        ]
    
    def _get_prompt_dir(self) -> Path:
        """Get the directory containing TROA prompts"""
        return Path(__file__).parent / "prompts"