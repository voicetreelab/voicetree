"""
VoiceTree Agentic Workflows - Clean Multi-Agent Architecture

This module implements a clean separation between:

1. CORE FRAMEWORK (core/):
   - BaseAgent: Common agent interface
   - AgentRegistry: Multi-agent management
   - MultiAgentExecutor: Execution coordination

2. AGENT DEFINITIONS (agents/):
   - TADA: Tree Action Decider Agent (Sequential)
   - TROA: Tree Reorganization Agent (Background)  
   - Rewriter: Content Rewriter Agent (Reactive)

3. EXECUTION INFRASTRUCTURE (infrastructure/):
   - LLM integration and calls
   - State management
   - Debugging and logging
   - Visualization tools

Clean APIs that hide complexity while supporting multiple agent types.
"""

# Core framework
from .core import (
    BaseAgent,
    AgentType,
    AgentRegistry,
    MultiAgentExecutor,
    AgentExecutionResult,
    get_agent,
    register_agent,
    list_agents
)

# All agents (auto-registered via import)
from . import agents

# Infrastructure (for advanced usage)
from .infrastructure import (
    VoiceTreeStateManager,
    call_llm,
    call_llm_structured
)

# Legacy compatibility
from .clean_main import CleanVoiceTreePipeline
from .main import VoiceTreePipeline, run_voicetree_pipeline

__all__ = [
    # Core framework - The main clean API
    'BaseAgent',
    'AgentType', 
    'AgentRegistry',
    'MultiAgentExecutor',
    'AgentExecutionResult',
    'get_agent',
    'register_agent',
    'list_agents',
    
    # Agent classes (for direct instantiation if needed)
    'agents',
    
    # Infrastructure (for advanced usage)
    'VoiceTreeStateManager',
    'call_llm', 
    'call_llm_structured',
    
    # Pipeline interfaces
    'CleanVoiceTreePipeline',
    
    # Legacy compatibility
    'VoiceTreePipeline',
    'run_voicetree_pipeline'
] 