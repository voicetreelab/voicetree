"""
Agent Executor - Executes clean agent definitions

This module takes a clean agent definition and executes it using
the infrastructure tools (LLM calls, state management, etc.).

Bridges the gap between pure agent specification and execution.
"""

from typing import Dict, Any, Optional
from ..agent import VoiceTreeAgent
from .llm_integration import call_llm_structured
from .debug_logger import log_stage_input_output
from ..schema_models import (
    SegmentationResponse, RelationshipResponse, 
    IntegrationResponse, NodeExtractionResponse
)


class AgentExecutor:
    """
    Executes VoiceTree agents using infrastructure tools
    
    Takes a clean agent definition and runs it with actual LLM calls,
    state management, and logging.
    """
    
    def __init__(self, agent: Optional[VoiceTreeAgent] = None):
        """Initialize with an agent definition"""
        self.agent = agent or VoiceTreeAgent()
        self.current_stage = "start"
        self.execution_log = []
    
    def execute(self, initial_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute the agent workflow with the given initial state
        
        Args:
            initial_state: Input state containing required data
            
        Returns:
            Final state after execution
        """
        state = initial_state.copy()
        state["current_stage"] = "segmentation"  # Start with first stage
        
        while state["current_stage"] != "END":
            try:
                state = self._execute_stage(state)
            except Exception as e:
                state["error_message"] = str(e)
                state["current_stage"] = "END"
                break
        
        return state
    
    def _execute_stage(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single stage of the workflow"""
        current_stage_id = state["current_stage"]
        stage = self.agent.get_stage(current_stage_id)
        
        if not stage:
            raise ValueError(f"Unknown stage: {current_stage_id}")
        
        # Validate inputs
        missing_inputs = []
        for input_key in stage.input_keys:
            if input_key not in state or state[input_key] is None:
                missing_inputs.append(input_key)
        
        if missing_inputs:
            raise ValueError(f"Missing inputs for {stage.id}: {missing_inputs}")
        
        # Prepare prompt
        prompt_template = self.agent.load_prompt(stage.prompt_file)
        prompt_data = {key: state[key] for key in stage.input_keys}
        prompt = prompt_template.format(**prompt_data)
        
        # Log input
        log_stage_input_output(stage.id, prompt_data, {})
        
        # Execute LLM call
        response = self._call_llm_for_stage(prompt, stage.id)
        
        # Store result in state 
        state[stage.output_key] = response
        
        # Log output
        log_stage_input_output(stage.id, prompt_data, {stage.output_key: response})
        
        # Determine next stage
        next_stage = self._determine_next_stage(stage.id, response, state)
        state["current_stage"] = next_stage
        
        # Record execution
        self.execution_log.append({
            "stage": stage.id,
            "inputs": list(prompt_data.keys()),
            "output": stage.output_key,
            "next_stage": next_stage
        })
        
        return state
    
    def _call_llm_for_stage(self, prompt: str, stage_id: str) -> Any:
        """Call LLM with appropriate response type for the stage"""
        # Map stage IDs to expected response types
        response_type_map = {
            "segmentation": "segmentation",
            "relationship_analysis": "relationship", 
            "integration_decision": "integration",
            "node_extraction": "extraction"
        }
        
        response_type = response_type_map.get(stage_id, "default")
        return call_llm_structured(prompt, response_type)
    
    def _determine_next_stage(self, current_stage: str, response: Any, state: Dict[str, Any]) -> str:
        """Determine next stage based on current stage and response"""
        # Check for errors first
        if hasattr(response, 'error') and response.error:
            return self.agent.get_next_stage(current_stage, "error")
        
        # Stage-specific logic
        if current_stage == "segmentation":
            if hasattr(response, 'chunks') and len(response.chunks) == 0:
                return self.agent.get_next_stage(current_stage, "no_chunks")
        
        elif current_stage == "integration_decision":
            if hasattr(response, 'integration_decisions') and len(response.integration_decisions) == 0:
                return self.agent.get_next_stage(current_stage, "no_decisions")
        
        # Default to success transition
        return self.agent.get_next_stage(current_stage, "success")
    
    def get_execution_summary(self) -> Dict[str, Any]:
        """Get a summary of the execution"""
        return {
            "stages_executed": len(self.execution_log),
            "execution_path": [log["stage"] for log in self.execution_log],
            "final_stage": self.current_stage,
            "execution_log": self.execution_log
        } 