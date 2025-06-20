"""
Agents Module - Multi-Agent Registry

Provides a clean API for accessing all available agents:
- TADA: Tree Action Decider Agent (Sequential)
- TROA: Tree Reorganization Agent (Background)
- Rewriter: Content Rewriter Agent (Reactive)

This module automatically registers all agents and provides discovery.
"""

from ..core.registry import register_agent
from .tada import TADAAgent
from .troa import TROAAgent  
from .rewriter import RewriterAgent

# Auto-register all agents
register_agent("tada", TADAAgent, {
    "type": "sequential",
    "description": "Tree Action Decider Agent - processes transcripts into tree actions",
    "stages": 4,
    "use_case": "primary_workflow"
})

register_agent("troa", TROAAgent, {
    "type": "background", 
    "description": "Tree Reorganization Agent - optimizes tree structure continuously",
    "stages": 6,
    "use_case": "background_optimization"
})

register_agent("rewriter", RewriterAgent, {
    "type": "reactive",
    "description": "Content Rewriter Agent - improves content quality on demand",
    "stages": 4,
    "use_case": "content_improvement"
})

# Clean API exports
__all__ = [
    'TADAAgent',
    'TROAAgent', 
    'RewriterAgent'
] 