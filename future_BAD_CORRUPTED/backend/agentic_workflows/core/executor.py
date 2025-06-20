"""
Multi-Agent Executor - Coordination and Execution

Provides execution coordination for multiple agents.
Handles different agent types (sequential, background, reactive) appropriately.
"""

from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from datetime import datetime
import asyncio
import threading
from .base_agent import BaseAgent, AgentType
from .registry import get_agent
from ..infrastructure.llm_integration import call_llm_structured
from ..infrastructure.debug_logger import log_stage_input_output
import logging


@dataclass
class AgentExecutionResult:
    """Result of agent execution"""
    agent_id: str
    agent_type: str
    success: bool
    start_time: datetime
    end_time: datetime
    execution_time_seconds: float
    stages_executed: List[str]
    final_state: Dict[str, Any]
    error_message: Optional[str] = None


class MultiAgentExecutor:
    """
    Coordinates execution of multiple agents
    
    Handles different agent types and execution patterns:
    - Sequential agents: Execute workflow stages in order
    - Background agents: Continuous processing
    - Reactive agents: Event-driven processing
    """
    
    def __init__(self):
        """Initialize multi-agent executor"""
        self.execution_history: List[AgentExecutionResult] = []
        self.background_tasks: Dict[str, threading.Thread] = {}
        self.is_running = False
    
    def execute_agent(
        self, 
        agent_id: str, 
        initial_state: Dict[str, Any],
        agent_kwargs: Optional[Dict[str, Any]] = None
    ) -> AgentExecutionResult:
        """
        Execute a single agent
        
        Args:
            agent_id: ID of agent to execute
            initial_state: Initial state for execution
            agent_kwargs: Optional arguments for agent instantiation
            
        Returns:
            Execution result
        """
        start_time = datetime.now()
        agent_kwargs = agent_kwargs or {}
        
        try:
            # Get agent instance
            agent = get_agent(agent_id, **agent_kwargs)
            if not agent:
                return self._create_error_result(
                    agent_id, "unknown", start_time, 
                    f"Agent {agent_id} not found"
                )
            
            # Execute based on agent type
            if agent.agent_type == AgentType.SEQUENTIAL:
                result = self._execute_sequential_agent(agent, initial_state, start_time)
            elif agent.agent_type == AgentType.BACKGROUND:
                result = self._execute_background_agent(agent, initial_state, start_time)
            elif agent.agent_type == AgentType.REACTIVE:
                result = self._execute_reactive_agent(agent, initial_state, start_time)
            else:
                result = self._create_error_result(
                    agent_id, agent.agent_type.value, start_time,
                    f"Unknown agent type: {agent.agent_type}"
                )
            
            self.execution_history.append(result)
            return result
            
        except Exception as e:
            return self._create_error_result(
                agent_id, "unknown", start_time, str(e)
            )
    
    def _execute_sequential_agent(
        self, 
        agent: BaseAgent, 
        initial_state: Dict[str, Any],
        start_time: datetime
    ) -> AgentExecutionResult:
        """Execute a sequential agent (like TADA)"""
        state = initial_state.copy()
        state["current_stage"] = agent.stages[0].id if agent.stages else "END"
        stages_executed = []
        
        while state.get("current_stage") != "END":
            try:
                current_stage_id = state["current_stage"]
                stage = agent.get_stage(current_stage_id)
                
                if not stage:
                    state["error_message"] = f"Unknown stage: {current_stage_id}"
                    break
                
                # Validate inputs
                missing_inputs = agent.validate_inputs(current_stage_id, state)
                if missing_inputs:
                    state["error_message"] = f"Missing inputs: {missing_inputs}"
                    break
                
                # Execute stage
                state = self._execute_stage(agent, stage, state)
                stages_executed.append(current_stage_id)
                
                # Determine next stage
                next_stage = agent.get_next_stage(current_stage_id, "success")
                state["current_stage"] = next_stage
                
            except Exception as e:
                state["error_message"] = str(e)
                state["current_stage"] = "END"
                break
        
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        return AgentExecutionResult(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type.value,
            success=not state.get("error_message"),
            start_time=start_time,
            end_time=end_time,
            execution_time_seconds=execution_time,
            stages_executed=stages_executed,
            final_state=state,
            error_message=state.get("error_message")
        )
    
    def _execute_background_agent(
        self,
        agent: BaseAgent,
        initial_state: Dict[str, Any],
        start_time: datetime
    ) -> AgentExecutionResult:
        """Execute a background agent (like TROA)"""
        # Background agents are started and run continuously
        # This returns immediately with a "started" result
        
        def background_worker():
            """Background worker function"""
            try:
                # This would contain the background agent logic
                # For now, just simulate background processing
                logging.info(f"Background agent {agent.agent_id} started")
                # Background agents run continuously until stopped
                
            except Exception as e:
                logging.error(f"Background agent {agent.agent_id} error: {e}")
        
        # Start background thread
        thread = threading.Thread(target=background_worker, daemon=True)
        thread.start()
        self.background_tasks[agent.agent_id] = thread
        
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        return AgentExecutionResult(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type.value,
            success=True,
            start_time=start_time,
            end_time=end_time,
            execution_time_seconds=execution_time,
            stages_executed=["background_start"],
            final_state={"status": "background_running", **initial_state}
        )
    
    def _execute_reactive_agent(
        self,
        agent: BaseAgent,
        initial_state: Dict[str, Any],
        start_time: datetime
    ) -> AgentExecutionResult:
        """Execute a reactive agent (like Rewriter)"""
        # Reactive agents execute a single workflow in response to events
        # Similar to sequential but typically shorter workflows
        
        state = initial_state.copy()
        stages_executed = []
        
        # Find the appropriate stage based on the event/trigger
        trigger_stage = self._find_trigger_stage(agent, state)
        if not trigger_stage:
            return self._create_error_result(
                agent.agent_id, agent.agent_type.value, start_time,
                "No appropriate trigger stage found"
            )
        
        state["current_stage"] = trigger_stage.id
        
        # Execute the reactive workflow
        while state.get("current_stage") != "END":
            try:
                current_stage_id = state["current_stage"]
                stage = agent.get_stage(current_stage_id)
                
                if not stage:
                    state["error_message"] = f"Unknown stage: {current_stage_id}"
                    break
                
                # Execute stage
                state = self._execute_stage(agent, stage, state)
                stages_executed.append(current_stage_id)
                
                # Determine next stage
                next_stage = agent.get_next_stage(current_stage_id, "success")
                state["current_stage"] = next_stage
                
            except Exception as e:
                state["error_message"] = str(e)
                state["current_stage"] = "END"
                break
        
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        return AgentExecutionResult(
            agent_id=agent.agent_id,
            agent_type=agent.agent_type.value,
            success=not state.get("error_message"),
            start_time=start_time,
            end_time=end_time,
            execution_time_seconds=execution_time,
            stages_executed=stages_executed,
            final_state=state,
            error_message=state.get("error_message")
        )
    
    def _execute_stage(self, agent: BaseAgent, stage, state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single stage of an agent"""
        # Prepare prompt
        prompt_template = agent.load_prompt(stage.prompt_file)
        prompt_data = {key: state.get(key, "") for key in stage.input_keys}
        prompt = prompt_template.format(**prompt_data)
        
        # Log input
        log_stage_input_output(f"{agent.agent_id}:{stage.id}", prompt_data, {})
        
        # Execute LLM call
        try:
            response = call_llm_structured(prompt, stage.stage_type)
            state[stage.output_key] = response
            
            # Log output
            log_stage_input_output(f"{agent.agent_id}:{stage.id}", prompt_data, {stage.output_key: response})
            
        except Exception as e:
            logging.error(f"Stage execution failed for {agent.agent_id}:{stage.id}: {e}")
            state["error_message"] = str(e)
        
        return state
    
    def _find_trigger_stage(self, agent: BaseAgent, state: Dict[str, Any]):
        """Find the appropriate trigger stage for a reactive agent"""
        # Simple implementation - return first stage
        # Could be made more sophisticated based on state analysis
        return agent.stages[0] if agent.stages else None
    
    def _create_error_result(
        self, 
        agent_id: str, 
        agent_type: str, 
        start_time: datetime, 
        error_message: str
    ) -> AgentExecutionResult:
        """Create an error result"""
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        return AgentExecutionResult(
            agent_id=agent_id,
            agent_type=agent_type,
            success=False,
            start_time=start_time,
            end_time=end_time,
            execution_time_seconds=execution_time,
            stages_executed=[],
            final_state={"error_message": error_message},
            error_message=error_message
        )
    
    def stop_background_agent(self, agent_id: str) -> bool:
        """Stop a background agent"""
        if agent_id in self.background_tasks:
            # Note: This is a simplified implementation
            # Real background agents would need proper shutdown coordination
            thread = self.background_tasks[agent_id]
            if thread.is_alive():
                logging.info(f"Stopping background agent {agent_id}")
                # Would need proper shutdown mechanism here
            del self.background_tasks[agent_id]
            return True
        return False
    
    def get_execution_history(self) -> List[AgentExecutionResult]:
        """Get execution history"""
        return self.execution_history.copy()
    
    def get_active_background_agents(self) -> List[str]:
        """Get list of active background agents"""
        return list(self.background_tasks.keys())
    
    def get_execution_stats(self) -> Dict[str, Any]:
        """Get execution statistics"""
        if not self.execution_history:
            return {"total_executions": 0}
        
        successful = [r for r in self.execution_history if r.success]
        failed = [r for r in self.execution_history if not r.success]
        
        avg_execution_time = sum(r.execution_time_seconds for r in self.execution_history) / len(self.execution_history)
        
        return {
            "total_executions": len(self.execution_history),
            "successful_executions": len(successful),
            "failed_executions": len(failed),
            "success_rate": len(successful) / len(self.execution_history),
            "average_execution_time_seconds": avg_execution_time,
            "active_background_agents": len(self.background_tasks)
        } 