"""
Rewriter Agent Definition - Background Content Rewriter

Reactive agent that rewrites node content to improve clarity and organization.
Responds to events like node content becoming stale or disorganized.

This is a pure agent definition using the clean architecture.
"""

from typing import List
from pathlib import Path
from ...core.base_agent import BaseAgent, AgentStage, AgentTransition, AgentType


class RewriterAgent(BaseAgent):
    """
    Background Content Rewriter Agent
    
    Reactive agent that responds to triggers for content improvement
    by rewriting node content for better clarity and organization.
    """
    
    def __init__(self):
        """Initialize Rewriter agent"""
        super().__init__(agent_id="rewriter", agent_type=AgentType.REACTIVE)
    
    def _define_stages(self) -> List[AgentStage]:
        """Define the Rewriter workflow stages"""
        return [
            AgentStage(
                id="content_analysis",
                name="Content Quality Analysis",
                description="Analyze node content for quality issues and improvement opportunities",
                prompt_file="content_analysis.txt",
                input_keys=["node_content", "transcript_history"],
                output_key="quality_analysis",
                stage_type="processing"
            ),
            AgentStage(
                id="rewrite_planning",
                name="Rewrite Planning",
                description="Plan how to improve the content structure and clarity",
                prompt_file="rewrite_planning.txt",
                input_keys=["quality_analysis", "node_content"],
                output_key="rewrite_plan",
                stage_type="decision"
            ),
            AgentStage(
                id="content_rewrite",
                name="Content Rewriting",
                description="Rewrite the content according to the plan",
                prompt_file="content_rewrite.txt",
                input_keys=["node_content", "transcript_history", "rewrite_plan"],
                output_key="rewritten_content",
                stage_type="output"
            ),
            AgentStage(
                id="quality_validation",
                name="Quality Validation",
                description="Validate that the rewritten content meets quality standards",
                prompt_file="quality_validation.txt",
                input_keys=["original_content", "rewritten_content"],
                output_key="validation_results",
                stage_type="processing"
            )
        ]
    
    def _define_transitions(self) -> List[AgentTransition]:
        """Define the Rewriter workflow transitions"""
        return [
            # Main rewrite flow
            AgentTransition("content_analysis", "rewrite_planning"),
            AgentTransition("rewrite_planning", "content_rewrite"),
            AgentTransition("content_rewrite", "quality_validation"),
            AgentTransition("quality_validation", "END"),
            
            # Error handling
            AgentTransition("content_analysis", "END", "error"),
            AgentTransition("rewrite_planning", "END", "error"),
            AgentTransition("content_rewrite", "END", "error"),
            AgentTransition("quality_validation", "END", "error"),
            
            # Conditional flows
            AgentTransition("content_analysis", "END", "no_improvement_needed"),
            AgentTransition("rewrite_planning", "END", "content_already_optimal"),
            AgentTransition("quality_validation", "content_rewrite", "quality_insufficient")
        ]
    
    def _get_prompt_dir(self) -> Path:
        """Get the directory containing Rewriter prompts"""
        return Path(__file__).parent / "prompts" 