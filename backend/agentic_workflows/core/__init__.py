"""
Core Agent Framework - Base Abstractions

Provides the foundational classes and interfaces for all agents:
- BaseAgent: Common agent interface
- AgentRegistry: Multi-agent management
- MultiAgentExecutor: Execution coordination

This is the clean API that hides implementation complexity.
"""

from .base_agent import BaseAgent, AgentStage, AgentTransition, AgentType
from .registry import AgentRegistry, get_agent, register_agent, list_agents
from .executor import MultiAgentExecutor, AgentExecutionResult

__all__ = [
    # Core abstractions
    'BaseAgent',
    'AgentType',
    'AgentStage', 
    'AgentTransition',
    
    # Agent management
    'AgentRegistry',
    'get_agent',
    'register_agent', 
    'list_agents',
    
    # Execution
    'MultiAgentExecutor',
    'AgentExecutionResult'
] 