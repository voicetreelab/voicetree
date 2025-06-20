"""
Workflow Interface - Thin API layer for agentic workflows
Provides a clean interface that abstracts LangGraph implementation details
"""

from typing import Dict, Any, List, Optional, Protocol
from abc import ABC, abstractmethod
from pathlib import Path
import json

from backend.agentic_workflows.graph_definition import (
    get_workflow_definition,
    get_stage_by_id,
    visualize_workflow
)


class WorkflowExecutor(Protocol):
    """Protocol for workflow executors"""
    
    def execute(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the workflow with given initial state"""
        ...


class WorkflowInterface:
    """
    Thin interface for agentic workflows.
    Abstracts away the specific implementation (LangGraph, custom, etc.)
    """
    
    def __init__(self, executor: Optional[WorkflowExecutor] = None):
        """
        Initialize the workflow interface
        
        Args:
            executor: Optional custom executor, defaults to LangGraph
        """
        self.definition = get_workflow_definition()
        self.executor = executor or self._get_default_executor()
    
    def _get_default_executor(self) -> WorkflowExecutor:
        """Get the default LangGraph executor"""
        try:
            from backend.agentic_workflows.graph import compile_voicetree_graph
            
            class LangGraphExecutor:
                def __init__(self):
                    self.app = compile_voicetree_graph()
                
                def execute(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
                    return self.app.invoke(initial_state)
            
            return LangGraphExecutor()
        except ImportError:
            raise RuntimeError("LangGraph not available. Please install dependencies.")
    
    def execute_workflow(
        self,
        transcript: str,
        existing_nodes: str = "",
        incomplete_buffer: str = "",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Execute the workflow with given inputs
        
        Args:
            transcript: The transcript to process
            existing_nodes: Summary of existing nodes
            incomplete_buffer: Any incomplete text from previous execution
            **kwargs: Additional parameters
            
        Returns:
            Workflow execution result
        """
        # Build initial state
        initial_state = {
            "transcript_text": transcript,
            "existing_nodes": existing_nodes,
            "incomplete_chunk_buffer": incomplete_buffer,
            "current_stage": "start",
            "error_message": None,
            **kwargs
        }
        
        # Execute workflow
        return self.executor.execute(initial_state)
    
    def get_stage_info(self, stage_id: str) -> Optional[Dict[str, Any]]:
        """Get information about a specific stage"""
        return get_stage_by_id(stage_id)
    
    def get_all_stages(self) -> List[Dict[str, Any]]:
        """Get all workflow stages"""
        return self.definition["stages"]
    
    def get_prompt_path(self, stage_id: str) -> Optional[Path]:
        """Get the prompt file path for a stage"""
        stage = get_stage_by_id(stage_id)
        if stage and "prompt" in stage:
            return Path(__file__).parent / "prompts" / stage["prompt"]
        return None
    
    def visualize(self) -> str:
        """Get a visual representation of the workflow"""
        return visualize_workflow()
    
    def validate_workflow(self) -> Dict[str, Any]:
        """
        Validate the workflow definition
        
        Returns:
            Validation result with any issues found
        """
        issues = []
        
        # Check all prompts exist
        for stage in self.definition["stages"]:
            prompt_path = self.get_prompt_path(stage["id"])
            if prompt_path and not prompt_path.exists():
                issues.append(f"Missing prompt file: {prompt_path}")
        
        # Check all transitions are valid
        stage_ids = {stage["id"] for stage in self.definition["stages"]}
        for source, target in self.definition["transitions"]:
            if source not in stage_ids:
                issues.append(f"Invalid source stage in transition: {source}")
            if target not in stage_ids and target != "END":
                issues.append(f"Invalid target stage in transition: {target}")
        
        return {
            "valid": len(issues) == 0,
            "issues": issues
        }


class SimpleWorkflowRunner:
    """
    Simple workflow runner that doesn't require LangGraph
    Useful for testing and development
    """
    
    def __init__(self, interface: WorkflowInterface):
        self.interface = interface
    
    def run_stage(
        self,
        stage_id: str,
        state: Dict[str, Any],
        mock_responses: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Run a single stage of the workflow
        
        Args:
            stage_id: ID of the stage to run
            state: Current workflow state
            mock_responses: Optional mock responses for testing
            
        Returns:
            Updated state
        """
        stage = self.interface.get_stage_info(stage_id)
        if not stage:
            raise ValueError(f"Unknown stage: {stage_id}")
        
        # In a real implementation, this would:
        # 1. Load the prompt template
        # 2. Format it with input data from state
        # 3. Call the LLM
        # 4. Parse the response
        # 5. Update the state
        
        if mock_responses and stage_id in mock_responses:
            result = mock_responses[stage_id]
            state[stage["output_key"]] = result
            state["current_stage"] = f"{stage_id}_complete"
        
        return state
    
    def run_workflow(
        self,
        initial_state: Dict[str, Any],
        mock_responses: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Run the complete workflow
        
        Args:
            initial_state: Initial workflow state
            mock_responses: Optional mock responses for testing
            
        Returns:
            Final workflow state
        """
        state = initial_state.copy()
        
        # Run through all stages in order
        for stage in self.interface.get_all_stages():
            state = self.run_stage(stage["id"], state, mock_responses)
        
        return state 