"""
Base Agent Class - Common Interface for All Agents

Defines the standard interface that all agents must implement.
Provides common functionality while allowing agent-specific customization.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from pathlib import Path
from dataclasses import dataclass
from enum import Enum


class AgentType(Enum):
    """Types of agents supported by the framework"""
    SEQUENTIAL = "sequential"    # Linear workflow (TADA)
    BACKGROUND = "background"    # Continuous background processing (TROA)
    REACTIVE = "reactive"        # Event-driven processing (Rewriter)


@dataclass
class AgentStage:
    """Definition of a single workflow stage (node)"""
    id: str
    name: str
    description: str
    prompt_file: str
    input_keys: List[str]
    output_key: str
    stage_type: str = "processing"  # processing, decision, output


@dataclass 
class AgentTransition:
    """Definition of a workflow transition (edge)"""
    from_stage: str
    to_stage: str
    condition: str = "success"


class BaseAgent(ABC):
    """
    Base class for all agents in the system
    
    Provides the standard interface and common functionality.
    Each agent type inherits from this and implements specific logic.
    """
    
    def __init__(self, agent_id: str, agent_type: AgentType):
        """
        Initialize base agent
        
        Args:
            agent_id: Unique identifier for this agent
            agent_type: Type of agent (sequential, background, reactive)
        """
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.stages = self._define_stages()
        self.transitions = self._define_transitions()
        self.prompt_dir = self._get_prompt_dir()
        
        # Validate agent definition
        self._validate_agent_definition()
    
    @abstractmethod
    def _define_stages(self) -> List[AgentStage]:
        """Define the workflow stages for this agent"""
        pass
    
    @abstractmethod
    def _define_transitions(self) -> List[AgentTransition]:
        """Define the workflow transitions for this agent"""
        pass
    
    @abstractmethod
    def _get_prompt_dir(self) -> Path:
        """Get the directory containing prompts for this agent"""
        pass
    
    def get_agent_info(self) -> Dict[str, Any]:
        """Get basic information about this agent"""
        return {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type.value,
            "stages": len(self.stages),
            "transitions": len(self.transitions),
            "prompt_dir": str(self.prompt_dir)
        }
    
    def get_stage(self, stage_id: str) -> Optional[AgentStage]:
        """Get a stage by ID"""
        for stage in self.stages:
            if stage.id == stage_id:
                return stage
        return None
    
    def get_next_stage(self, current_stage: str, condition: str = "success") -> str:
        """Get the next stage based on current stage and condition"""
        for transition in self.transitions:
            if transition.from_stage == current_stage and transition.condition == condition:
                return transition.to_stage
        return "END"
    
    def get_prompt_path(self, prompt_file: str) -> Path:
        """Get the full path to a prompt file"""
        return self.prompt_dir / prompt_file
    
    def load_prompt(self, prompt_file: str) -> str:
        """Load a prompt template from file"""
        prompt_path = self.get_prompt_path(prompt_file)
        if prompt_path.exists():
            return prompt_path.read_text(encoding='utf-8')
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    
    def get_dataflow_spec(self) -> Dict[str, Any]:
        """Get the complete dataflow specification for this agent"""
        return {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type.value,
            "stages": [
                {
                    "id": stage.id,
                    "name": stage.name,
                    "description": stage.description,
                    "inputs": stage.input_keys,
                    "output": stage.output_key,
                    "prompt": stage.prompt_file,
                    "type": stage.stage_type
                }
                for stage in self.stages
            ],
            "transitions": [
                {
                    "from": t.from_stage,
                    "to": t.to_stage,
                    "condition": t.condition
                }
                for t in self.transitions
            ]
        }
    
    def validate_inputs(self, stage_id: str, inputs: Dict[str, Any]) -> List[str]:
        """Validate that all required inputs are provided for a stage"""
        stage = self.get_stage(stage_id)
        if not stage:
            return [f"Unknown stage: {stage_id}"]
        
        missing_inputs = []
        for input_key in stage.input_keys:
            if input_key not in inputs or inputs[input_key] is None:
                missing_inputs.append(input_key)
        
        return missing_inputs
    
    def _validate_agent_definition(self):
        """Validate that the agent definition is consistent"""
        # Check that all stages have unique IDs
        stage_ids = [stage.id for stage in self.stages]
        if len(stage_ids) != len(set(stage_ids)):
            raise ValueError(f"Agent {self.agent_id} has duplicate stage IDs")
        
        # Check that all transitions reference valid stages
        valid_stages = set(stage_ids) | {"END"}
        for transition in self.transitions:
            if transition.from_stage not in valid_stages:
                raise ValueError(f"Transition from unknown stage: {transition.from_stage}")
            if transition.to_stage not in valid_stages:
                raise ValueError(f"Transition to unknown stage: {transition.to_stage}")
        
        # Check that all prompt files exist
        for stage in self.stages:
            prompt_path = self.get_prompt_path(stage.prompt_file)
            if not prompt_path.exists():
                raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    
    def __str__(self) -> str:
        return f"{self.agent_id} ({self.agent_type.value}): {len(self.stages)} stages"
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.agent_id} type={self.agent_type.value}>" 